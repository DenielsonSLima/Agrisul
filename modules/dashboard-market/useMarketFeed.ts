'use client';
import {useQueries,useQueryClient} from '@tanstack/react-query';
import {authenticatedFetch} from '@/shared/supabase/rpc';
import {billingKeys} from '@/shared/query/keys';
import type {MarketFeed,MarketId} from './catalog';
import {marketFeedGroups,mergeMarketFeed,parseMarketFeed,readMarketSnapshot,saveMarketSnapshot,staleMarketFeed} from './marketSnapshot.mjs';

const groups=['currency','agriculture','cane'] as const;
function snapshotStorage(){try{return typeof window==='undefined'?undefined:window.localStorage;}catch{return undefined;}}
export function useMarketFeed(userId:string){
  const client=useQueryClient();
  const queries=useQueries({queries:groups.map(group=>{
    const config=marketFeedGroups[group];
    const queryKey=[...billingKeys.resource(userId,'dashboard-market'),{group}] as const;
    return {
      queryKey,enabled:!!userId,
      initialData:()=>readMarketSnapshot(snapshotStorage(),userId,group) as MarketFeed|undefined,
      initialDataUpdatedAt:0,
      queryFn:async({signal}:{signal:AbortSignal}):Promise<MarketFeed>=>{
        const response=await authenticatedFetch(`/api/dashboard-market?group=${group}`,{signal});
        if(!response.ok)throw new Error('Não foi possível consultar as referências de mercado.');
        const current=parseMarketFeed(await response.json(),group);
        if(!current)throw new Error('A fonte retornou referências de mercado inválidas.');
        if(signal.aborted)throw new DOMException('Consulta cancelada','AbortError');
        const previous=client.getQueryData<MarketFeed>(queryKey)??readMarketSnapshot(snapshotStorage(),userId,group);
        const feed=mergeMarketFeed(previous,current,group) as MarketFeed;
        saveMarketSnapshot(snapshotStorage(),userId,group,feed);
        return feed;
      },
      staleTime:config.refreshSeconds*1000,refetchInterval:config.refreshSeconds*1000,
      refetchOnReconnect:true,refetchOnWindowFocus:true,
    };
  })});
  const feeds=queries.flatMap(query=>query.data?[query.isError?staleMarketFeed(query.data) as MarketFeed:query.data]:[]);
  const pendingIds=new Set<MarketId>(groups.flatMap((group,index)=>queries[index].isPending?marketFeedGroups[group].ids as MarketId[]:[]));
  const data:MarketFeed|undefined=feeds.length?{
    quotes:feeds.flatMap(feed=>feed.quotes),
    checkedAt:feeds.reduce((latest,feed)=>Date.parse(feed.checkedAt)>Date.parse(latest)?feed.checkedAt:latest,feeds[0].checkedAt),
    refreshSeconds:Math.min(...feeds.map(feed=>feed.refreshSeconds)),
  }:undefined;
  return {
    data,isPending:queries.every(query=>query.isPending),isFetching:queries.some(query=>query.isFetching),isError:queries.some(query=>query.isError),
    pendingIds,isQuotePending:(id:MarketId)=>pendingIds.has(id),
    refetch:()=>Promise.all(queries.map(query=>query.refetch())),
  };
}
