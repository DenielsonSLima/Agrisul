import {rpcRequest} from '@/shared/supabase/rpc';
import type {ExecutiveSummaryData,SummaryData,SummarySelection} from '../types';
export const fetchSummary = (companyId: string, month: string, signal?: AbortSignal) =>
  rpcRequest<SummaryData>('summary', 'list', {companyId, month}, signal);

const dimensions=[['partnerIds','partnerId'],['contractIds','contractId'],['farmIds','farmId'],['plotIds','plotId']] as const;
const canonicalIds=(ids:readonly string[]=[])=>[...new Set(ids.filter(Boolean))].sort();
export function normalizeSummarySelection(selection:SummarySelection){
 return {contractId:selection.contractId,status:selection.status,partnerId:selection.partnerId??'',farmId:selection.farmId??'',plotId:selection.plotId??'',
  partnerIds:canonicalIds(selection.partnerIds),contractIds:canonicalIds(selection.contractIds),farmIds:canonicalIds(selection.farmIds),plotIds:canonicalIds(selection.plotIds),...(selection.contractMethod?{contractMethod:selection.contractMethod}:{})};
}

export async function fetchExecutiveSummary(companyId:string,from:string,to:string,signal?:AbortSignal,selection:SummarySelection={contractId:'',status:''}){
 const normalized=normalizeSummarySelection(selection);
 const payload={companyId,from,to,...(normalized.contractMethod?{contractMethod:normalized.contractMethod}:{}),...(normalized.contractId?{contractId:normalized.contractId}:{}),...(normalized.status?{status:normalized.status}:{}),...(normalized.partnerId?{partnerId:normalized.partnerId}:{}),...(normalized.farmId?{farmId:normalized.farmId}:{}),...(normalized.plotId?{plotId:normalized.plotId}:{}),
  ...Object.fromEntries(dimensions.filter(([plural])=>normalized[plural].length).map(([plural])=>[plural,normalized[plural]]))};
 const data=await rpcRequest<ExecutiveSummaryData>('summary','dashboard',payload,signal);
 // Never display an unfiltered result as if the chosen selection were applied.
 const selectionFields=['contractId','status','partnerId','farmId','plotId','contractMethod'] as const;
 const selected=selectionFields.some(field=>normalized[field])||dimensions.some(([plural])=>normalized[plural].length);
 const invalidArrays=()=>dimensions.some(([plural,singular])=>{
  // Legacy farmId + plotId narrows to that plot; it must not select the entire farm.
  const legacy=singular==='farmId'&&normalized.plotId?'':normalized[singular];
  const expected=canonicalIds([...normalized[plural],legacy]),echo=data.filters?.[plural];
  if(normalized[plural].length&&!Array.isArray(echo))return true;
  return echo!==undefined&&(!Array.isArray(echo)||JSON.stringify(canonicalIds(echo))!==JSON.stringify(expected));
 });
 if(selected&&(!data.filters||data.filters.companyId!==companyId||selectionFields.some(field=>(data.filters?.[field]??'')!==(normalized[field]??''))||invalidArrays())){
  throw new Error('Não foi possível aplicar a seleção. Limpe os filtros e tente novamente.');
 }
 return data;
}
