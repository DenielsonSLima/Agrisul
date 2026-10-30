import {createClient} from 'npm:@supabase/supabase-js@2.115.0';
import {createWeatherProvider} from '../../../modules/dashboard-news/weatherProviders.mjs';

const url=Deno.env.get('SUPABASE_URL')??'',key=Deno.env.get('SUPABASE_ANON_KEY')??'',serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const service=createClient(url,serviceKey,options);
const call=async(action:string,payload:Record<string,unknown>)=>{
 const {data,error}=await service.rpc('dashboard_weather_cache',{p_action:action,p_payload:payload}).abortSignal(AbortSignal.timeout(8000));
 if(error)throw Error('Cache de clima indisponível.');return data;
};
const provider=createWeatherProvider({store:{read:(cityId:string)=>call('get',{cityId}),save:(cityId:string,payload:unknown,fetchedAt:string)=>call('save',{cityId,payload,fetchedAt}),failed:(cityId:string)=>call('failed',{cityId,error:'INMET indisponível.'})}});
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
Deno.serve(async request=>{
 if(request.method!=='POST')return reply({error:'Método não permitido.'},405);
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return reply({error:'Entre para acompanhar a previsão.'},401);
 const client=createClient(url,key,{...options,global:{headers:{Authorization:authorization}}});
 const {data,error}=await client.auth.getUser(authorization.slice(7));
 if(error||!data.user)return reply({error:'Entre para acompanhar a previsão.'},401);
 const raw=await request.text();if(raw.length>1000)return reply({error:'Cidades inválidas.'},400);
 let body;
 try{body=JSON.parse(raw);if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['ids','action','q'].includes(key))||!['feed','prepare','search'].includes(body.action??'feed'))throw Error();
  if(body.action==='search'){if(typeof body.q!=='string'||body.q.trim().length<2||body.q.length>80)throw Error();}
  else if(!Array.isArray(body.ids)||body.ids.length>20||new Set(body.ids).size!==body.ids.length||body.ids.some((id:unknown)=>typeof id!=='string'||!/^\d{7}$/.test(id)))throw Error();}
 catch{return reply({error:'Selecione até 20 cidades válidas.'},400);}
 try{
  const cities=body.action==='search'?await provider.search(body.q):await provider.cities(body.ids);
  await call('register',{cities});
  if(body.action==='prepare'||body.action==='search')return reply({cities});
  return reply(await provider.feed(body.ids));
 }
 catch{return reply({error:'Não foi possível consultar a previsão.'},503);}
});
