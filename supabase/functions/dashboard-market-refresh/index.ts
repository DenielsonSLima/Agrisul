import {createClient} from 'npm:@supabase/supabase-js@2.115.0';
import {getMarketFeed} from '../../../modules/dashboard-market/providers.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {getAgriculturalFeed} from './agriculture.mjs';

const url=Deno.env.get('SUPABASE_URL')??'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const token=Deno.env.get('DASHBOARD_MARKET_REFRESH_TOKEN')??'';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function authorized(candidate:string){
 if(!candidate||!token)return false;
 const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const [left,right]=await Promise.all([digest(candidate),digest(token)]);
 return left.reduce((difference,byte,index)=>difference|(byte^right[index]),0)===0;
}
Deno.serve(async request=>{
 if(request.method!=='POST')return reply({error:'Método não permitido.'},405);
 if(!await authorized(request.headers.get('x-market-refresh-token')??''))return reply({error:'Coletor não autorizado.'},401);
 if(!url||!serviceKey)return reply({error:'Coletor indisponível.'},503);
 const raw=await request.text();if(raw.length>1000)return reply({error:'Dados inválidos.'},400);
 let group:'currency'|'agriculture'|'cane';
 try{
  const body=JSON.parse(raw);
  if(!body||Array.isArray(body)||Object.keys(body).some(key=>key!=='group')||!['currency','agriculture','cane'].includes(body.group))throw Error();
  group=body.group;
 }catch{return reply({error:'Grupo de mercado inválido.'},400);}
 const client=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const call=async(action:string,payload:Record<string,unknown>)=>{
  const {data,error}=await client.rpc('refresh_dashboard_market',{p_action:action,p_payload:payload}).abortSignal(AbortSignal.timeout(15000));
  if(error)throw Error('Falha ao persistir a consulta de mercado.');return data;
 };
 let lease:string|undefined;
 try{
  lease=(await call('claim',{group})).token;
  if(!lease)return reply({group,skipped:true});
  const feed=group==='agriculture'?await getAgriculturalFeed({unzipSync,strFromU8}):await getMarketFeed(group);
  await call('finish',{group,token:lease,quotes:feed.quotes});
  return reply({group,updated:true,available:feed.quotes.filter(quote=>quote.status==='available').length});
 }catch{
  if(lease)await call('finish',{group,token:lease,quotes:[],error:'Consulta externa interrompida; última publicação preservada.'}).catch(()=>{});
  return reply({error:'Não foi possível atualizar as referências de mercado.'},503);
 }
});
