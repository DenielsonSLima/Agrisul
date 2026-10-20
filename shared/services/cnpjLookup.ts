import type {CompanyDetails} from '@/shared/types/companyDetails';
import {normalizeCnpj} from '@/shared/utils/cnpj';

export class LookupError extends Error {
 constructor(message:string,public status:number){super(message);this.name='LookupError';}
}
type Json=Record<string,unknown>;
const object=(value:unknown):Json=>value&&typeof value==='object'&&!Array.isArray(value)?value as Json:{};
const text=(data:Json,key:string)=>typeof data[key]==='string'?(data[key] as string).trim():typeof data[key]==='number'?String(data[key]):'';
const unavailable=()=>new LookupError('Os serviços públicos de consulta estão indisponíveis. Tente novamente ou preencha os dados manualmente.',503);
const limited=()=>new LookupError('O serviço público de consulta limitou temporariamente as solicitações. Aguarde um pouco ou preencha os dados manualmente.',429);

function fromBrasilApi(data:Json,cnpj:string):CompanyDetails {
 if(!text(data,'razao_social')||normalizeCnpj(text(data,'cnpj'))!==cnpj)throw new LookupError('A consulta retornou dados incompletos. Tente novamente ou preencha manualmente.',502);
 return {cnpj,legalName:text(data,'razao_social'),tradeName:text(data,'nome_fantasia'),street:[text(data,'descricao_tipo_de_logradouro'),text(data,'logradouro')].filter(Boolean).join(' '),number:text(data,'numero'),complement:text(data,'complemento'),district:text(data,'bairro'),city:text(data,'municipio'),state:text(data,'uf'),zipCode:text(data,'cep'),phone:text(data,'ddd_telefone_1')||text(data,'ddd_telefone_2'),email:text(data,'email')};
}
function fromCnpjWs(data:Json,cnpj:string):CompanyDetails {
 const establishment=object(data.estabelecimento);
 if(!text(data,'razao_social')||normalizeCnpj(text(establishment,'cnpj'))!==cnpj)throw new LookupError('A consulta retornou dados incompletos. Tente novamente ou preencha manualmente.',502);
 return {cnpj,legalName:text(data,'razao_social'),tradeName:text(establishment,'nome_fantasia'),street:[text(establishment,'tipo_logradouro'),text(establishment,'logradouro')].filter(Boolean).join(' '),number:text(establishment,'numero'),complement:text(establishment,'complemento'),district:text(establishment,'bairro'),city:text(object(establishment.cidade),'nome'),state:text(object(establishment.estado),'sigla'),zipCode:text(establishment,'cep'),phone:[text(establishment,'ddd1'),text(establishment,'telefone1')].join('')||[text(establishment,'ddd2'),text(establishment,'telefone2')].join(''),email:text(establishment,'email')};
}
function fromOpenCnpj(data:Json,cnpj:string):CompanyDetails {
 if(!text(data,'razao_social')||normalizeCnpj(text(data,'cnpj'))!==cnpj)throw new LookupError('A consulta retornou dados incompletos. Tente novamente ou preencha manualmente.',502);
 const phones=Array.isArray(data.telefones)?data.telefones.map(object):[];
 const phone=phones.find(value=>value.is_fax!==true&&text(value,'numero'));
 return {cnpj,legalName:text(data,'razao_social'),tradeName:text(data,'nome_fantasia'),street:[text(data,'tipo_logradouro'),text(data,'logradouro')].filter(Boolean).join(' '),number:text(data,'numero'),complement:text(data,'complemento'),district:text(data,'bairro'),city:text(data,'municipio'),state:text(data,'uf'),zipCode:text(data,'cep'),phone:phone?[text(phone,'ddd'),text(phone,'numero')].join(''):'',email:text(data,'email')};
}

// Only public registration fields are cached. No credentials or user payloads.
// Fallbacks use independent public APIs; Minha Receita is already BrasilAPI's
// upstream and must not be retried directly to get around its limits.
// https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/docs/doc/cnpj.json
// https://opencnpj.org/ — independent public Receita Federal dataset.
// https://docs.cnpj.ws/referencia-de-api/api-publica/consultando-cnpj
export function createCnpjLookup(dependencies:{fetch?:typeof fetch;now?:()=>number}={}){
 const request=dependencies.fetch??((...args:Parameters<typeof fetch>)=>fetch(...args));
 const now=dependencies.now??Date.now;
 const cache=new Map<string,{value:CompanyDetails;expires:number}>();
 const inFlight=new Map<string,Promise<CompanyDetails>>();
 const providers=[
  {name:'brasilapi',url:'https://brasilapi.com.br/api/cnpj/v1/',map:fromBrasilApi,timeout:6000,perMinuteLimit:Infinity},
  {name:'opencnpj',url:'https://api.opencnpj.org/',map:fromOpenCnpj,timeout:6000,perMinuteLimit:30},
  {name:'cnpj-ws',url:'https://publica.cnpj.ws/cnpj/',map:fromCnpjWs,timeout:12000,perMinuteLimit:3},
 ];
 const cooldown=providers.map(()=>0);
 const providerRequests=providers.map(()=>[] as number[]);
 async function consult(cnpj:string,index:number):Promise<CompanyDetails>{
  if(now()<cooldown[index])throw limited();
  if(Number.isFinite(providers[index].perMinuteLimit)){
   const requests=providerRequests[index];
   while(requests.length&&requests[0]<=now()-60000)requests.shift();
   if(requests.length>=providers[index].perMinuteLimit)throw limited();
   requests.push(now());
  }
  let response:Response;
  try{response=await request(providers[index].url+encodeURIComponent(cnpj),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(providers[index].timeout),redirect:'manual'});}
  catch(error){
   console.warn('cnpj_lookup_provider_network_error',{
    provider:providers[index].name,
    error:error instanceof Error?error.name:typeof error,
    message:error instanceof Error?error.message:'Unknown fetch failure',
    cause:error instanceof Error&&'cause' in error?String(error.cause):undefined,
   });
   if(error instanceof Error&&error.name==='TimeoutError')throw new LookupError('O serviço público demorou para responder. Tente novamente ou preencha manualmente.',504);
   throw unavailable();
  }
  if(response.status===429){
   const header=response.headers.get('retry-after');
   const seconds=header&&/^\d+(?:\.\d+)?$/.test(header)?Number(header):NaN;
   const retryAt=Number.isFinite(seconds)?now()+seconds*1000:header?Date.parse(header):NaN;
   cooldown[index]=Math.max(now()+60000,Number.isFinite(retryAt)?retryAt:0);
   throw limited();
  }
  if(response.status===404)throw new LookupError('CNPJ não encontrado na base pública consultada. Confira o número informado.',404);
  if(response.status===400)throw new LookupError('Este CNPJ não foi aceito pela consulta. Confira ou preencha os dados manualmente.',400);
  if(!response.ok){
   console.warn('cnpj_lookup_provider_http_error',{provider:providers[index].name,status:response.status});
   throw unavailable();
  }
  let data:unknown;
  try{data=await response.json();}catch{
   console.warn('cnpj_lookup_provider_invalid_json',{provider:providers[index].name});
   throw new LookupError('O serviço público retornou uma resposta inválida. Tente novamente ou preencha manualmente.',502);
  }
  return providers[index].map(object(data),cnpj);
 }
 async function load(cnpj:string):Promise<CompanyDetails>{
  const failures:LookupError[]=[];
  for(let index=0;index<providers.length;index++){
   try{return await consult(cnpj,index);}catch(error){
    if(!(error instanceof LookupError)||error.status===400||error.status===404)throw error;
    failures.push(error);
   }
  }
  if(failures.every(error=>error.status===429))throw limited();
  if(failures.every(error=>error.status===504)||failures.every(error=>error.status===502))throw failures[0];
  throw unavailable();
 }
 return async(cnpjInput:string):Promise<CompanyDetails>=>{
  const cnpj=normalizeCnpj(cnpjInput);
  if(!/^\d{14}$/.test(cnpj))throw new LookupError('A consulta pública aceita CNPJ numérico com 14 dígitos. Confira ou preencha manualmente.',400);
  const existing=cache.get(cnpj);
  if(existing&&existing.expires>now())return {...existing.value};
  cache.delete(cnpj);
  let pending=inFlight.get(cnpj);
  if(!pending){
   pending=load(cnpj).then(value=>{
    if(cache.size>=200)cache.delete(cache.keys().next().value!);
    cache.set(cnpj,{value,expires:now()+15*60000});
    return value;
   }).finally(()=>{inFlight.delete(cnpj);});
   inFlight.set(cnpj,pending);
  }
  return {...await pending};
 };
}
export const lookupCnpj=createCnpjLookup();
