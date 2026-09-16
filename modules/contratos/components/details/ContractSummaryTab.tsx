import {useEffect,useRef,useState,type FormEvent} from 'react';
import {CalendarDays,FileText,Loader2,Save} from 'lucide-react';
import {Textarea} from '@/components/ui/textarea';
import {notifications} from '@/shared/feedback';
import type {BillingContract,ContractInput} from '../../types';
import {contractSummaryDetails} from '../../utils/contractSummaryDetails';
import {useContractsMutation} from '../../hooks/useContracts';
import {ContractSummaryHero} from './ContractSummaryHero';
import {ContractSummaryFinancialOverview} from './ContractSummaryFinancialOverview';

const inputWithNotes=(contract:BillingContract,notes:string):ContractInput=>({
 title:contract.title,contractNumber:contract.contractNumber,companyId:contract.companyId,clientId:contract.clientId,typeId:contract.typeId,status:contract.status,
 startDate:contract.startDate,endDate:contract.endDate,contractedVolume:contract.contractedVolume,
 atrPriceType:contract.atrPriceType,atrPeriodType:contract.atrPeriodType,value:contract.value,notes,
});

export function ContractSummaryTab({contract,onBusy}:{contract:BillingContract;onBusy?:(busy:boolean)=>void}){
 const mutation=useContractsMutation(),summary=contractSummaryDetails(contract);
 const [notes,setNotes]=useState(contract.notes),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const mounted=useRef(true),cleanNotes=notes.trim(),dirty=cleanNotes!==contract.notes;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{onBusy?.(saving);return()=>onBusy?.(false);},[saving,onBusy]);

 const saveNotes=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(saving||!dirty)return;setError('');setSaving(true);
  try{await mutation.mutateAsync({id:contract.id,input:inputWithNotes(contract,cleanNotes)});notifications.updated(cleanNotes?'As observações do contrato foram atualizadas.':'As observações do contrato foram removidas.');}
  catch(caught){const message=(caught as Error).message||'Não foi possível salvar as observações.';if(mounted.current)setError(message);notifications.error(message);}
  finally{if(mounted.current)setSaving(false);}
 };

 return <div className="contract-detail-tab contract-summary-tab">
  <ContractSummaryHero contract={contract} summary={summary}/>

  <ContractSummaryFinancialOverview contract={contract}/>

  <div className="contract-summary-content">
   <section className="contract-summary-section contract-conditions-panel"><div className="contract-summary-section-heading"><span className="contract-summary-icon"><CalendarDays size={18}/></span><div><small>Dados essenciais</small><h3>Condições do contrato</h3></div></div><dl className="contract-condition-grid">{summary.conditions.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></section>
   <form className="contract-summary-section contract-notes-panel" onSubmit={saveNotes}><div className="contract-summary-section-heading"><span className="contract-summary-icon"><FileText size={18}/></span><div><small>Registro interno</small><h3>Observações</h3></div></div><label htmlFor="contract-summary-notes">Adicione informações importantes para acompanhar este contrato.</label><Textarea id="contract-summary-notes" rows={5} maxLength={4000} value={notes} disabled={saving} aria-invalid={!!error} onChange={event=>{setNotes(event.target.value);if(error)setError('');}} placeholder="Ex.: acordos comerciais, condições especiais ou orientações para a equipe."/><div className="contract-notes-footer"><span>{notes.length.toLocaleString('pt-BR')} / 4.000 caracteres</span><button className="btn company-primary" type="submit" disabled={saving||!dirty}>{saving?<Loader2 className="animate-spin" size={15}/>:<Save size={15}/>} {saving?'Salvando…':'Salvar observações'}</button></div>{error&&<p className="form-error" role="alert">{error}</p>}</form>
  </div>
 </div>;
}
