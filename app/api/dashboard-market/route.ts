import {getRequestUser,getRequestSupabase} from '@/shared/supabase/server';

export const dynamic='force-dynamic';
export async function GET(request:Request){
  if(!await getRequestUser(request))return Response.json({error:'Entre para acompanhar o mercado.'},{status:401,headers:{'Cache-Control':'no-store'}});
  const group=new URL(request.url).searchParams.get('group');
  if(group!==null&&group!=='currency'&&group!=='agriculture'&&group!=='cane')return Response.json({error:'Grupo de mercado inválido.'},{status:400,headers:{'Cache-Control':'no-store'}});
  const client=getRequestSupabase(request)!;
  const {data,error}=await client.rpc('billing_rpc',{p_resource:'dashboard-market',p_action:'get',p_payload:group?{group}:{}}).abortSignal(request.signal);
  if(error)return Response.json({error:'Não foi possível consultar as referências de mercado.'},{status:503,headers:{'Cache-Control':'no-store'}});
  return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
}
