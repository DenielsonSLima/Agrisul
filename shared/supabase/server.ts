import {createClient} from '@supabase/supabase-js';
import {getSupabaseConfig} from './client';
export function getRequestSupabase(request:Request){
  const authorization=request.headers.get('authorization');
  if(!authorization?.startsWith('Bearer '))return null;
  const {url,key}=getSupabaseConfig();
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:authorization}}});
}
export async function getRequestUser(request:Request){
  const client=getRequestSupabase(request);if(!client)return null;
  const token=request.headers.get('authorization')!.slice(7);
  const {data,error}=await client.auth.getUser(token);
  return error?null:data.user;
}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function handleResourceRequest(request:Request,resource:string){
  const client=getRequestSupabase(request);
  if(!client)return reply({error:'Entre para continuar.'},401);
  const url=new URL(request.url);
  const read=request.method==='GET';
  if(!read){
    const origin=request.headers.get('origin');
    if(origin&&origin!==url.origin)return reply({error:'Origem não autorizada.'},403);
    if(request.method!=='DELETE'&&!request.headers.get('content-type')?.includes('application/json'))return reply({error:'Formato inválido.'},415);
  }
  let payload:Record<string,unknown>;
  if(read)payload=Object.fromEntries(url.searchParams);
  else{
    const raw=await request.text();
    if(raw.length>64000)return reply({error:'Dados muito longos.'},413);
    try{payload=raw?JSON.parse(raw):Object.fromEntries(url.searchParams)}catch{return reply({error:'Dados inválidos.'},400);}
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return reply({error:'Dados inválidos.'},400);
  }
  const action=read?(payload.id?'get':'list'):request.method==='DELETE'?'delete':'save';
  const {data,error,status}=await client.rpc('billing_rpc',{p_resource:resource,p_action:action,p_payload:payload});
  if(error){
    const code=error.code;
    const mapped=code==='28000'||code==='PGRST301'?401:code==='42501'?403:code==='P0002'?404:['23503','23505','23514'].includes(code)?409:code?.startsWith('22')||code==='P0001'?400:status>=400?status:503;
    return reply({error:mapped>=500?'Não foi possível concluir. Tente novamente.':error.message},mapped);
  }
  return reply(data,request.method==='POST'?201:200);
}
