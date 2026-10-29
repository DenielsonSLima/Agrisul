'use client';
import {useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {ATR_PAGE_SIZE,fetchAtr} from '@/modules/cadastro/atr/services/atrApi';

export function useDashboardAtr(){
 // Share the registration cache and central Realtime invalidation. The RPC
 // already orders references newest first and returns all four exact values.
 const query=useCadastroQuery('atr',{page:1,pageSize:ATR_PAGE_SIZE},signal=>fetchAtr(1,signal));
 return {...query,record:query.data?.records[0]??null,records:query.data?.records.slice(0,3)??[]};
}
