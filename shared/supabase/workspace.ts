import {rpcRequest} from '@/shared/supabase/rpc';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function fetchWorkspaceId(){
 const {settings}=await rpcRequest<{settings:{workspaceId?:string}}>('settings','get');
 if(!settings.workspaceId||!uuid.test(settings.workspaceId))throw new Error('Não foi possível identificar o espaço de trabalho. Entre novamente.');
 return settings.workspaceId;
}
