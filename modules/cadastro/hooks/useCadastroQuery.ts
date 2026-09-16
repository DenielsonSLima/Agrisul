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

export function useCadastroMutation<TInput,TResult>(resource:string,save:(input:TInput)=>Promise<TResult>,related:string[]=[]){
  const {user}=useAuth();
  const queryClient=useQueryClient();
  return useMutation({
    mutationFn:async(input:TInput)=>{
      if(!user)throw new RpcError('Entre para salvar seus cadastros.',401);
      await Promise.all(mutationResources(resource,related).map(key=>queryClient.cancelQueries({queryKey:billingKeys.resource(user.id,key)})));
      return save(input);
    },
    onSuccess:async()=>{
      if(!user)return;
      await Promise.all(mutationResources(resource,related).map(key=>queryClient.invalidateQueries({queryKey:billingKeys.resource(user.id,key)})));
    },
    onError:async(error)=>{
      if(user&&error instanceof RpcError&&error.status===409){
        await Promise.all(mutationResources(resource,related).map(key=>queryClient.invalidateQueries({queryKey:billingKeys.resource(user.id,key)})));
      }
    },
  });
}
