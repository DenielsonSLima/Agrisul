import {getRequestUser} from '@/shared/supabase/server';
import {getWeatherFeed,searchWeatherCities} from '@/modules/dashboard-news/weatherProviders.mjs';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
 if(!await getRequestUser(request))return Response.json({error:'Entre para acompanhar o clima.'},{status:401,headers});
 const params=new URL(request.url).searchParams,query=params.get('q');
 if(query!==null){if(query.trim().length<2||query.length>80)return Response.json({error:'Digite entre 2 e 80 caracteres.'},{status:400,headers});try{return Response.json({cities:await searchWeatherCities(query)},{headers});}catch{return Response.json({error:'A busca de cidades está temporariamente indisponível.'},{status:503,headers});}}
 const raw=params.get('ids')??'';if(!raw||raw.length>170||!/^\d{7}(?:,\d{7}){0,19}$/.test(raw))return Response.json({error:'Selecione entre 1 e 20 cidades.'},{status:400,headers});
 const ids=raw.split(',');if(new Set(ids).size!==ids.length)return Response.json({error:'Não repita cidades.'},{status:400,headers});
 try{return Response.json(await getWeatherFeed(ids),{headers});}catch{return Response.json({error:'Não foi possível consultar as cidades selecionadas.'},{status:503,headers});}
}
