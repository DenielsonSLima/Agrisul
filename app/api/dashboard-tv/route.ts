import {getRequestUser} from '@/shared/supabase/server';
import {getTvFeed} from '@/modules/dashboard-tv/providers';

export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!await getRequestUser(request))return Response.json({error:'Entre para acompanhar a TV Agro.'},{status:401,headers:{'Cache-Control':'no-store'}});
 return Response.json(await getTvFeed(),{headers:{'Cache-Control':'private, no-store'}});
}
