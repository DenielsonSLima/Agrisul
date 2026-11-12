import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ResumoPage} from '../../modules/resumo/components/ResumoPage';
import type {SummaryFilterOptions} from '../../modules/resumo/types';
import '../../modules/resumo/dashboard.css';
import '../../modules/resumo/quickFilters.css';

const options:SummaryFilterOptions={statuses:['Ativo','Finalizado'],partners:[{id:'client-a',name:'Cliente São José'},{id:'client-b',name:'Cliente União'}],contracts:[
 {id:'contract-a',clientId:'client-a',clientName:'Cliente São José',contractNumber:'001',title:'Contrato A',status:'Ativo'},
 {id:'contract-b',clientId:'client-b',clientName:'Cliente União',contractNumber:'002',title:'Contrato B',status:'Finalizado'}],farms:[
 {id:'farm-a',name:'Fazenda A',plots:[{id:'plot-a1',name:'A1'},{id:'plot-a2',name:'A2'}]},
 {id:'farm-b',name:'Fazenda B',plots:[{id:'plot-b1',name:'B1'}]}]};
const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30_000,refetchOnWindowFocus:false}}});
const listeners=new Set<()=>void>();
const state={actor:'owner-one',companyId:'company-one',revision:0,hold:false,aborts:0,
 requests:[] as Array<{actor:string;action:string;payload:Record<string,unknown>}>,pending:[] as Array<()=>void>,
 subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);},
 notify(){state.revision++;for(const listener of listeners)listener();},
 release(){state.hold=false;for(const resolve of state.pending.splice(0))resolve();},
 refresh:()=>queryClient.invalidateQueries({queryKey:['billing',state.actor,'summary']}),
 switchCompany(){state.companyId=state.companyId==='company-one'?'company-two':'company-one';state.notify();},
 switchActor(){state.actor=state.actor==='owner-one'?'owner-two':'owner-one';queryClient.clear();state.notify();},
 client:{rpc(_name:string,args:{p_resource:string;p_action:string;p_payload:Record<string,unknown>}){
  return {retry(){return this;},abortSignal(signal:AbortSignal){return handle(args.p_resource,args.p_action,args.p_payload,signal);}};
 }}
};
Object.assign(window,{dashboardFiltersQA:state});
function snapshot(payload:Record<string,unknown>){
 const partnerIds=(payload.partnerIds??[]) as string[];
 const loadedVolume=partnerIds.length===2?'30':partnerIds[0]==='client-a'?'10':partnerIds[0]==='client-b'?'20':'100';
 const metrics={loadCount:3,loadedVolume,averageAtr:'140',grossAmount:'1000',netAmount:'900',billingPending:false,pendingLoadCount:0};
 const totals={...metrics,contractCount:2,activeContractCount:2,farmCount:2,plotCount:3,discountAmount:'100',advanceAmount:'0',receiptAmount:'0',receivedAmount:'0',pendingAmount:'900',creditAmount:'0'};
 const from=String(payload.from),to=String(payload.to),filters={companyId:payload.companyId,contractId:'',status:'',partnerId:'',farmId:'',plotId:'',partnerIds:[],contractIds:[],farmIds:[],plotIds:[],contractMethod:'',...payload};
 return {filters,filterOptions:options,range:{from,to,dayCount:7,generatedAt:'2026-11-12T12:00:00Z'},totals,comparison:{...totals,from,to,volumeChangePercent:'5',loadChangePercent:'5',atrChange:'1',grossChangePercent:'5',netChangePercent:'5',receivedChangePercent:'0'},
  operationalTotals:{...metrics,averageLoadVolume:'10',contractCount:2,farmCount:2,plotCount:3},months:[],monthlyOperations:[],farmPerformance:[],plotPerformance:[],contractPerformance:[],contracts:[],farms:[],contractStatus:options.statuses.map(status=>({status,count:1})),
  days:[{...metrics,date:from,previousProductionDate:'',volumeChangePercent:'',grossChangePercent:''},{...metrics,date:to,previousProductionDate:from,volumeChangePercent:'5',grossChangePercent:'5'}],
  contractMethods:[{code:'1',label:'Manual',loadCount:1,loadedVolume:'10',averageAtr:'140'},{code:'2',label:'Mecanizada',loadCount:2,loadedVolume:'20',averageAtr:'140'}],contractProgress:[],
  planning:{scope:'workspace',periodCount:0,activePeriodCount:0,periodName:'',progressAsOf:to,targetAreaHa:'0',allocatedAreaHa:'0',plantedAreaHa:'0',managedAreaHa:'0',lostAreaHa:'0',fieldLogCount:0,managementEventCount:0,harvestTargetTons:'0',harvestedTons:'0',plantingPercent:'0',harvestPercent:'0'},
  agriculture:{scope:'workspace',registeredFarmCount:2,registeredPlotCount:3,farmAreaHa:'0',plotAreaHa:'0'},management:[],planningPerformance:{periodName:'',farms:[],plots:[]},dimensions:{partners:[],contractTypes:[]},harvestMethods:[]};
}
function handle(resource:string,action:string,payload:Record<string,unknown>,signal:AbortSignal){
 if(resource!=='summary')throw new Error('Unexpected fixture resource '+resource);
 const data=snapshot(payload);state.requests.push({actor:state.actor,action,payload:structuredClone(payload)});
 signal.addEventListener('abort',()=>{state.aborts++;},{once:true});
 return state.hold?new Promise(resolve=>state.pending.push(()=>resolve({data,error:null,status:200}))):Promise.resolve({data,error:null,status:200});
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><ResumoPage/></QueryClientProvider>);
