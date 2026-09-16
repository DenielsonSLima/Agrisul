import {getSupabaseBrowserClient} from "@/shared/supabase/client";
import {rpcRequest,RpcError} from "@/shared/supabase/rpc";
import {fetchWorkspaceId} from "@/shared/supabase/workspace";
import type {Company,CompanyInput,CompanyDetails,CompanyLogoChange} from "../types";
export class CompanyApiError extends Error{constructor(message:string,public status:number){super(message)}}
const logoBucket="billing-company-logos";
export async function fetchCompanies(signal?:AbortSignal):Promise<Company[]>{
 const data=await rpcRequest<{companies:Company[]}>("companies","list",{},signal);
 if(signal?.aborted)throw new DOMException("Consulta cancelada","AbortError");
 const paths=[...new Set(data.companies.map(company=>company.logoKey).filter((key):key is string=>!!key))];
 if(!paths.length)return data.companies.map(company=>({...company,logoKey:company.logoKey??null,logoName:company.logoName??"",logoUrl:null}));
 const {data:signed,error}=await getSupabaseBrowserClient().storage.from(logoBucket).createSignedUrls(paths,3600);
 if(signal?.aborted)throw new DOMException("Consulta cancelada","AbortError");
 if(error)throw new Error("Não foi possível carregar as logos das empresas. Tente novamente.");
 const urls=new Map((signed??[]).filter(item=>!item.error&&item.signedUrl).map(item=>[item.path,item.signedUrl]));
 return data.companies.map(company=>({...company,logoKey:company.logoKey??null,logoName:company.logoName??"",logoUrl:company.logoKey?urls.get(company.logoKey)??null:null}));
}
export async function persistCompany(data:CompanyInput,id?:string,logo?:CompanyLogoChange){
 const client=getSupabaseBrowserClient();const storage=client.storage.from(logoBucket);
 let uploadedKey:string|undefined;
 const payload:Record<string,unknown>={...data,...(id?{id}:{})};
 if(logo?.file){
  const {data:{session},error:authError}=await client.auth.getSession();
  if(authError||!session)throw new CompanyApiError("Entre na sua conta para enviar a logo.",401);
  const extension=({"image/png":"png","image/jpeg":"jpg","image/webp":"webp"} as Record<string,string>)[logo.file.type];
  if(!extension||!logo.file.size||logo.file.size>3*1024*1024)throw new Error("Envie uma logo PNG, JPG ou WebP de até 3 MB.");
  const workspaceId=await fetchWorkspaceId();
  uploadedKey=`${workspaceId}/companies/${crypto.randomUUID()}.${extension}`;
  const {error}=await storage.upload(uploadedKey,logo.file,{contentType:logo.file.type,upsert:false});
  if(error)throw new Error("Não foi possível enviar a logo. Verifique o arquivo e tente novamente.");
  payload.logoKey=uploadedKey;payload.logoName=logo.file.name;
 }else if(logo?.remove){payload.removeLogo=true;}
 try{
  const result=await rpcRequest<{id:string;company:Company;previousLogoKey:string|null}>("companies","save",payload);
  const old=result.previousLogoKey??logo?.previousKey;
  if(old&&old!==uploadedKey&&(logo?.remove||uploadedKey))void storage.remove([old]);
  return result;
 }catch(error){
  if(uploadedKey&&error instanceof RpcError&&error.status<500)void storage.remove([uploadedKey]);
  throw error;
 }
}
export async function fetchCnpj(cnpj:string,signal?:AbortSignal):Promise<CompanyDetails>{
 const {data:{session},error}=await getSupabaseBrowserClient().auth.getSession();
 if(error||!session)throw new CompanyApiError("Entre na sua conta para consultar o CNPJ.",401);
 const response=await fetch("/api/companies/lookup?cnpj="+encodeURIComponent(cnpj),{signal,cache:"no-store",headers:{Authorization:`Bearer ${session.access_token}`}});
 const body=await response.json().catch(()=>({error:"Resposta inesperada. Tente novamente."})) as {error?:string;company?:CompanyDetails};
 if(!response.ok)throw new CompanyApiError(body.error||"Não foi possível consultar o CNPJ.",response.status);
 if(!body.company)throw new CompanyApiError("Resposta inesperada. Tente novamente.",502);
 return body.company;
}
