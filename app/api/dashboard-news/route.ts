import {getRequestUser} from '@/shared/supabase/server';
import {getNewsFeed} from '@/modules/dashboard-news/providers.mjs';

export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!await getRequestUser(request))return Response.json({error:'Entre para acompanhar as notícias.'},{status:401,headers:{'Cache-Control':'no-store'}});
 return Response.json(await getNewsFeed(),{headers:{'Cache-Control':'private, no-store'}});
}
