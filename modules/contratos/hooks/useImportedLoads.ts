import {useEffect,useState} from 'react';
import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {rpcRequest} from '@/shared/supabase/rpc';
import type {ContractLoad} from '../types';

export type ImportOriginMatchStatus='matched'|'missing-code'|'not-found'|'ambiguous';
export type ImportedLoadPart={entryId:string;label:string;volume:string|null;atr?:string};
export type ImportedAtrInput={atrMode:'pending'|'source'|'general'|'parts';atr:string;atrParts:{entryId:string;atr:string}[]};
export interface ImportedLoadCandidate {
 documentId:string;sourceName:string;updatedAt:string;tripKey:string;loadedAt:string;volume:string|null;
 groupKey:string;groupOrdinal:number|null;groupVolume:string|null;groupEntryCount:number;groupOriginCount:number;
 matchedFarmId:string|null;matchedPlotId:string|null;farmMatchStatus:ImportOriginMatchStatus;plotMatchStatus:ImportOriginMatchStatus|'unresolved-farm';
 harvestMethod:'1'|'2'|null;entryCount:number;entryNumber:string|null;farmCode:string|null;plotCode:string|null;issue:string;
 parts:ImportedLoadPart[];
}
export function useImportedLoads(companyId:string,contractId:string){
 return useCadastroQuery('import-documents',{view:'pending-loads',snapshotVersion:3,companyId,contractId},signal=>
  rpcRequest<{loads:ImportedLoadCandidate[];canManage:boolean}>('import-documents','pending-loads',{companyId,contractId},signal),!!companyId&&!!contractId);
}
export function useLinkImportedLoad(){
 return useCadastroMutation('import-documents',(input:{companyId:string;contractId:string;id:string;tripKey:string;expectedUpdatedAt:string;farmId:string;plotId:string}&ImportedAtrInput)=>
  rpcRequest<{load:ContractLoad;created:boolean}>('import-documents','link-load',input),['contracts','summary']);
}
export function useUnlinkImportedLoad(){
 return useCadastroMutation('import-documents',(input:{companyId:string;contractId:string;loadId:string;expectedUpdatedAt:string})=>
  rpcRequest<{id:string;unlinked:boolean}>('import-documents','unlink-load',input),['contracts','summary']);
}
export function useImportedAtrPreview(scope:{companyId:string;contractId:string;id:string;tripKey:string;expectedUpdatedAt:string},input:ImportedAtrInput){
 const serialized=JSON.stringify({...scope,...input});
 const [settled,setSettled]=useState(serialized);
 useEffect(()=>{const timer=setTimeout(()=>setSettled(serialized),300);return()=>clearTimeout(timer);},[serialized]);
 const payload=JSON.parse(settled) as typeof scope&ImportedAtrInput;
 const query=useCadastroQuery('import-documents',{view:'atr-preview',...payload},signal=>
  rpcRequest<{average:string|null;complete:boolean}>('import-documents','atr-preview',payload,signal),input.atrMode!=='pending'&&payload.atrMode!=='pending');
 const current=serialized===settled;
 return {average:current?query.data?.average:null,complete:input.atrMode==='pending'||current&&query.data?.complete===true,
  loading:input.atrMode!=='pending'&&(!current||query.loading),error:input.atrMode==='pending'?'':current?query.error:''};
}
