import {useCallback,useEffect,useRef,useState} from 'react';
import '../loads.css';
import './details/contractMonthlySummary.css';
import {Check,CheckCircle2,FileDown,Pencil} from 'lucide-react';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {ModuleLink,useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {useContractLifecycleMutation,useContracts} from '../hooks/useContracts';
import {defaultLoadFilters,useContractLoads} from '../hooks/useContractLoads';
import {contractHref} from '../utils/contractFormat';
import {ContractBreadcrumb} from './ContractBreadcrumb';
import {ContractLoadState} from './ContractLoadState';
import {ContractForm} from '../forms/ContractForm';
import {ContractSummaryTab} from './details/ContractSummaryTab';
import {ContractFinancialTab} from './details/ContractFinancialTab';
import {ContractLoadsTab} from './details/ContractLoadsTab';
import {ContractMonthlyReportDialog} from './ContractMonthlyReportDialog';
import {ContractTabReportDialog} from './ContractTabReportDialog';
import {financialReportModel,loadsReportModel,type ContractTabReport} from '../reporting/contractTabPdf';
import type {BillingContract} from '../types';
import {notifications,useConfirmation} from '@/shared/feedback';
import {formatContractBilling,formatContractVolume} from '../utils/contractFormat';

export function ContractDetail({id,editing,saved}:{id:string;editing:boolean;saved:boolean}){
 const m=useContracts(id),c=m.contract,loadedId=c?.id,lifecycle=useContractLifecycleMutation(),confirm=useConfirmation();
 const [childBusy,setChildBusy]=useState(false),[reportOpen,setReportOpen]=useState(false);const titleRef=useRef<HTMLHeadingElement>(null),closing=useRef(false);
 const busy=childBusy||lifecycle.isPending;
 const {searchParams,navigate}=useModuleNavigation();
 const requestedTab=searchParams.get('aba')??'summary';
 const tab=['summary','financial','loads'].includes(requestedTab)?requestedTab:'summary';
 const setTab=(value:string)=>{const params=new URLSearchParams(searchParams);params.set('aba',value);navigate('/contratos?'+params.toString());};
 const [loadFilters,setLoadFilters]=useState(defaultLoadFilters);
 const loads=useContractLoads(id,loadFilters,!editing&&tab==='loads');
 const [tabReport,setTabReport]=useState<{contract:BillingContract;model:ContractTabReport}|null>(null);
 const exportCurrent=()=>{if(!c)return;if(tab==='loads'){if(loads.data&&!loads.loading&&!loads.error)setTabReport({contract:c,model:loadsReportModel(loads.data)});}else if(tab==='financial')setTabReport({contract:c,model:financialReportModel(c)});else setReportOpen(true);};
 const onBusy=useCallback((value:boolean)=>setChildBusy(value),[]);
 const close=async()=>{
  if(!c||closing.current)return;
  const totals=c.financialSummary?.totals,credit=totals?.creditAmount??'',remaining=c.remainingVolume;
  const description=totals?.billingPending
   ?'Há faturamento pendente de ATR ou cotação. O banco só permitirá o encerramento depois dessa regularização.'
   :`O contrato será movido para Finalizados. ${formatContractVolume(remaining)} deixarão de ser esperadas como entrega.${credit&&credit!=='0'?` O crédito de ${formatContractBilling(credit)} ficará disponível para estorno na aba Financeiro.`:''}`;
  if(!await confirm({title:'Encerrar contrato?',description,confirmLabel:'Encerrar contrato'}))return;
  closing.current=true;
  try{await lifecycle.mutateAsync(c.id);notifications.updated(credit&&credit!=='0'?'Contrato encerrado. O saldo excedente já pode ser estornado no Financeiro.':'O contrato foi encerrado e movido para Finalizados.');}
  catch(reason){notifications.error((reason as Error).message||'Não foi possível encerrar o contrato.');}
  finally{closing.current=false;}
 };
 useEffect(()=>{if(loadedId)titleRef.current?.focus();},[loadedId,editing]);
 if(m.loading||m.error||!c)return <section className="contract-detail-page"><ContractBreadcrumb name="Detalhes do contrato"/><ContractLoadState {...m} onRetry={m.reload}/></section>;
 return <section className="contract-detail-page">
  <ContractBreadcrumb name={editing?'Editar':c.clientName} parent={editing?{name:c.clientName,href:contractHref(c.id)}:undefined} back={editing?contractHref(c.id):undefined} backLabel={editing?'Voltar para o contrato':'Voltar para contratos'}/>
  <div className="companies-heading contract-detail-heading"><div><h2 ref={titleRef} tabIndex={-1}>{editing?'Editar contrato':c.clientName}</h2><p>{c.typeName} · {c.companyName}{c.contractNumber?` · Nº ${c.contractNumber}`:''}</p></div>{!editing&&<div className="contract-detail-actions">{c.status==='Ativo'&&<button type="button" className="btn contract-close-button" disabled={busy} onClick={()=>{void close();}}><CheckCircle2 size={15}/>Encerrar contrato</button>}<button type="button" className="btn" disabled={busy||tab==='loads'&&(loads.loading||!!loads.error||!loads.data)} title={tab==='loads'?'Exportar carregamentos com os filtros selecionados':tab==='financial'?'Exportar financeiro':'Exportar resumo do contrato'} onClick={exportCurrent}><FileDown size={15}/>Exportar</button><ModuleLink className="btn" href={contractHref(id)+'&editar=1'}><Pencil size={15}/>Editar</ModuleLink></div>}</div>
  {saved&&<p className="company-saved" role="status"><Check size={16}/>Contrato salvo.</p>}
  {editing?<ContractForm contract={c} onBusy={onBusy}/>:<Tabs value={tab} onValueChange={setTab} className="contract-detail-tabs"><TabsList variant="line" aria-label="Áreas do contrato"><TabsTrigger disabled={busy} value="summary">Resumo</TabsTrigger><TabsTrigger disabled={busy} value="financial">Financeiro</TabsTrigger><TabsTrigger disabled={busy} value="loads">Carregamentos</TabsTrigger></TabsList><TabsContent value="summary"><ContractSummaryTab key={c.id+':'+c.notes} contract={c} onBusy={onBusy}/></TabsContent><TabsContent value="financial"><ContractFinancialTab contract={c} onBusy={onBusy}/></TabsContent><TabsContent value="loads"><ContractLoadsTab contract={c} filters={loadFilters} onFilters={setLoadFilters} query={loads}/></TabsContent></Tabs>}
  {reportOpen&&<ContractMonthlyReportDialog open onOpenChange={setReportOpen} contract={c}/>}
  {tabReport&&<ContractTabReportDialog contract={tabReport.contract} model={tabReport.model} onClose={()=>setTabReport(null)}/>}
 </section>;
}

