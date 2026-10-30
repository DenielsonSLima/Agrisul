import {getRequestUser,getRequestSupabase} from '@/shared/supabase/server';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
async function invoke(request:Request,body:Record<string,unknown>){const {data,error}=await getRequestSupabase(request)!.functions.invoke('dashboard-weather',{body,signal:request.signal});if(error)throw error;return data;}
export async function GET(request:Request){
 if(!await getRequestUser(request))return Response.json({error:'Entre para acompanhar o clima.'},{status:401,headers});
 const params=new URL(request.url).searchParams,query=params.get('q');
 if(query!==null){if(query.trim().length<2||query.length>80)return Response.json({error:'Digite entre 2 e 80 caracteres.'},{status:400,headers});try{return Response.json(await invoke(request,{action:'search',q:query}),{headers});}catch{return Response.json({error:'A busca de cidades está temporariamente indisponível.'},{status:503,headers});}}
 const raw=params.get('ids')??'';if(!raw||raw.length>170||!/^\d{7}(?:,\d{7}){0,19}$/.test(raw))return Response.json({error:'Selecione entre 1 e 20 cidades.'},{status:400,headers});
 const ids=raw.split(',');if(new Set(ids).size!==ids.length)return Response.json({error:'Não repita cidades.'},{status:400,headers});
 try{return Response.json(await invoke(request,{ids}),{headers});}catch{return Response.json({error:'Não foi possível consultar as cidades selecionadas.'},{status:503,headers});}
}
export async function POST(request:Request){
 if(!await getRequestUser(request))return Response.json({error:'Entre para configurar as cidades.'},{status:401,headers});
 try{const raw=await request.text();if(raw.length>1000)throw Error();const body=JSON.parse(raw);if(!body||Array.isArray(body)||Object.keys(body).some(key=>key!=='ids')||!Array.isArray(body.ids)||body.ids.length>20||new Set(body.ids).size!==body.ids.length||body.ids.some((id:unknown)=>typeof id!=='string'||!/^\d{7}$/.test(id)))throw Error();return Response.json(await invoke(request,{action:'prepare',ids:body.ids}),{headers});}
 catch{return Response.json({error:'Não foi possível conferir as cidades no IBGE.'},{status:400,headers});}
}
