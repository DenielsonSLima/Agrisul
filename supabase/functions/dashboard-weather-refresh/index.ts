import {createClient} from 'npm:@supabase/supabase-js@2.115.0';
import {createWeatherProvider} from '../../../modules/dashboard-news/weatherProviders.mjs';
const url=Deno.env.get('SUPABASE_URL')??'',serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',secret=Deno.env.get('DASHBOARD_WEATHER_REFRESH_TOKEN')??'';
const client=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const call=async(action:string,payload:Record<string,unknown>={})=>{const {data,error}=await client.rpc('dashboard_weather_cache',{p_action:action,p_payload:payload}).abortSignal(AbortSignal.timeout(10000));if(error)throw Error('Cache de clima indisponível.');return data;};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function authorized(candidate:string){
 if(!candidate||!secret)return false;
 const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const [a,b]=await Promise.all([digest(candidate),digest(secret)]);return a.reduce((result,byte,index)=>result|(byte^b[index]),0)===0;
}
Deno.serve(async request=>{
 if(request.method!=='POST')return reply({error:'Método não permitido.'},405);
 if(!await authorized(request.headers.get('x-weather-refresh-token')??''))return reply({error:'Coletor não autorizado.'},401);
 try{
  const cities=await call('due'),results=[];
  const provider=createWeatherProvider({cityDirectory:cities,store:{read:(cityId:string)=>call('get',{cityId}),save:(cityId:string,payload:unknown,fetchedAt:string)=>call('save',{cityId,payload,fetchedAt})}});
  for(let offset=0;offset<cities.length;offset+=5){
   results.push(...await Promise.all(cities.slice(offset,offset+5).map(async(city:{id:string})=>{
    const lease=await call('claim',{cityId:city.id});if(!lease.token)return {cityId:city.id,skipped:true};
    let success=false;
    try{const feed=await provider.feed([city.id]);success=feed.cities[0]?.status==='current';}catch{}
    await call('finish',{cityId:city.id,token:lease.token,success,...(success?{}:{error:'INMET indisponível; última referência preservada.'})});
    return {cityId:city.id,success};
   })));
  }
  return reply({results});
 }catch{return reply({error:'Não foi possível concluir a coleta.'},503);}
});
