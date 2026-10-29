import {getRequestUser} from '@/shared/supabase/server';
import {getMarketFeed} from '@/modules/dashboard-market/providers.mjs';

export const dynamic='force-dynamic';
export async function GET(request:Request){
  if(!await getRequestUser(request))return Response.json({error:'Entre para acompanhar o mercado.'},{status:401,headers:{'Cache-Control':'no-store'}});
  const group=new URL(request.url).searchParams.get('group');
  if(group!==null&&group!=='currency'&&group!=='agriculture'&&group!=='cane')return Response.json({error:'Grupo de mercado inválido.'},{status:400,headers:{'Cache-Control':'no-store'}});
  return Response.json(await getMarketFeed(group??undefined),{headers:{'Cache-Control':'private, no-store'}});
}
