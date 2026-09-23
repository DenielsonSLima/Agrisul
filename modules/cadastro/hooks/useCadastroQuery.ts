import {useEffect,useRef} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {RpcError} from '@/shared/supabase/rpc';
import {billingKeys} from '@/shared/query/keys';
import {mutationResources} from '@/shared/query/derivedResources';

export function useCadastroQuery<T>(resource:string,params:Record<string,unknown>,fetcher:(signal:AbortSignal)=>Promise<T>,enabled=true){
  const {user,ready}=useAuth();
  const query=useQuery({
    queryKey:[...billingKeys.resource(user?.id??'',resource),params],
    queryFn:({signal})=>fetcher(signal),
    enabled:ready&&!!user&&enabled,
  });
  const status=ready&&!user?401:query.error instanceof RpcError?query.error.status:query.error?503:0;
  return {
    data:query.data,
    loading:!ready||(!!user&&enabled&&query.isPending),
    error:status===401?'Entre para acessar seus cadastros.':query.error?.message??'',
    status,
    authRequired:status===401,
    reload:async()=>{if(user&&enabled)await query.refetch();},
  };
}

export function shouldRefreshAfterMutationError(error:unknown){
  if(error instanceof RpcError)return error.status===409||error.status>=500;
  if(typeof DOMException!=='undefined'&&error instanceof DOMException){
    return error.name==='TimeoutError'||error.name==='NetworkError';
  }
  if(error instanceof TypeError)return true;
  return error instanceof Error&&/(?:network|failed to fetch|timeout|timed out|conex[aã]o)/i.test(error.message);
}

export function useCadastroMutation<TInput,TResult>(resource:string,save:(input:TInput)=>Promise<TResult>,related:string[]=[]){
  const {user}=useAuth();
  const queryClient=useQueryClient();
  const activeUserIdRef=useRef<string|null>(user?.id??null);
  useEffect(()=>{activeUserIdRef.current=user?.id??null;},[user?.id]);
  const resources=mutationResources(resource,related);
  const refresh=async(actorId:string,settled=false)=>{
    const jobs=resources.map(key=>queryClient.invalidateQueries({queryKey:billingKeys.resource(actorId,key)}));
    if(settled){await Promise.allSettled(jobs);return;}
    await Promise.all(jobs);
  };
  return useMutation({
    onMutate:async()=>{
      const actorId=activeUserIdRef.current;
      if(actorId){
        await Promise.all(resources.map(key=>queryClient.cancelQueries({queryKey:billingKeys.resource(actorId,key)})));
      }
      return {actorId};
    },
    mutationFn:async(input:TInput)=>{
      if(!user)throw new RpcError('Entre para salvar seus cadastros.',401);
      return save(input);
    },
    onSuccess:async(_result,_input,context)=>{
      if(!context.actorId||activeUserIdRef.current!==context.actorId)return;
      await refresh(context.actorId);
    },
    onError:async(error,_input,context)=>{
      if(!context?.actorId||activeUserIdRef.current!==context.actorId||!shouldRefreshAfterMutationError(error))return;
      // A falha pode ter ocorrido depois do commit. Reconciliamos o cache sem
      // substituir o erro original caso a própria reconsulta também falhe.
      await refresh(context.actorId,true);
    },
  });
}
