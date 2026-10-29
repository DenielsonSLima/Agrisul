import {useEffect,useRef,useState} from 'react';
import {FileCheck2,Link2,Loader2} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Choice,Field} from '@/shared/components/Common';
import {importDocumentHref} from '@/modules/importacoes/navigation';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {notifications} from '@/shared/feedback';
import {useFarms} from '@/modules/cadastro/fazenda/hooks/useFarms';
import {usePlots} from '@/modules/cadastro/talhoes/hooks/usePlots';
import {useImportedLoads,useLinkImportedLoad,type ImportedLoadCandidate} from '../../hooks/useImportedLoads';
import type {BillingContract} from '../../types';
import {formatContractDate} from '../../utils/contractFormat';

const formatCandidateVolume=(value:string|null)=>value===null?'—':new Intl.NumberFormat('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3}).format(Number(value))+' t';

export function ImportedLoadsQueue({contract}:{contract:BillingContract}){
 const query=useImportedLoads(contract.companyId,contract.id);
 const [selected,setSelected]=useState<ImportedLoadCandidate|null>(null);
 const trigger=useRef<HTMLElement|null>(null);
 return <section className="loads-results imported-loads-queue" aria-label="Carregamentos dos PDFs finalizados">
  <header className="loads-results-heading"><div><h3><FileCheck2 size={18}/> PDFs prontos para vincular</h3><span>Documentos finalizados do parceiro deste contrato · carregamentos por origem · ATR preenchido depois</span></div><span>{query.data?.loads.length??'—'} carregamentos</span></header>
  {query.loading?<p className="imported-loads-state" role="status"><Loader2 size={16} className="animate-spin"/> Consultando documentos finalizados…</p>:query.error?<p className="imported-loads-state" role="alert">{query.error} <button type="button" className="btn" onClick={()=>void query.reload()}>Tentar novamente</button></p>:!query.data?.loads.length?<p className="imported-loads-state">Ao finalizar um PDF nas Importações, os conjuntos deste parceiro aparecem aqui para vinculação.</p>:<div className="loads-table-wrap"><table className="loads-table"><thead><tr><th>Movimento / documento</th><th>Origem do PDF</th><th>Colheita</th><th className="numeric">Quantidade (t)</th><th>Vínculo</th></tr></thead><tbody>{query.data.loads.map(candidate=><tr key={candidate.documentId+candidate.tripKey}><td><strong>{formatContractDate(candidate.loadedAt)} · Entrada {candidate.entryNumber||'sem número'}</strong><small>{candidate.sourceName} · {candidate.entryCount} linha(s)</small></td><td>Fazenda {candidate.farmCode||'—'}<small>Talhão {candidate.plotCode||'—'}</small></td><td>{candidate.harvestMethod==='1'?'Manual':candidate.harvestMethod==='2'?'Mecanizada':'Conferir coluna K'}</td><td className="numeric">{candidate.volume===null?'—':formatCandidateVolume(candidate.volume)}</td><td>{candidate.issue?<><span className="loads-money-pending">{candidate.issue}</span><ModuleLink className="btn small" href={importDocumentHref(candidate.documentId,{tab:'finished'})}>Abrir PDF</ModuleLink></>:query.data?.canManage&&contract.status==='Ativo'?<button type="button" className="btn small company-primary" onClick={()=>{trigger.current=document.activeElement as HTMLElement;setSelected(candidate);}}><Link2 size={14}/>Vincular</button>:<span>Somente consulta</span>}</td></tr>)}</tbody></table></div>}
  {selected&&<LinkImportedLoadDialog key={selected.documentId+selected.tripKey} candidate={selected} contract={contract} onClose={()=>setSelected(null)} returnFocus={()=>trigger.current?.isConnected&&trigger.current.focus()}/>}
 </section>;
}
function LinkImportedLoadDialog({candidate,contract,onClose,returnFocus}:{candidate:ImportedLoadCandidate;contract:BillingContract;onClose:()=>void;returnFocus:()=>void}){
 const farms=useFarms(),mutation=useLinkImportedLoad();const [farmId,setFarmId]=useState(''),[plotId,setPlotId]=useState(''),[error,setError]=useState('');const plots=usePlots(farmId);
 const mounted=useRef(true),busy=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const submit=async(event:React.FormEvent)=>{event.preventDefault();if(busy.current)return;busy.current=true;setError('');
  try{const result=await mutation.mutateAsync({companyId:contract.companyId,contractId:contract.id,id:candidate.documentId,tripKey:candidate.tripKey,expectedUpdatedAt:candidate.updatedAt,farmId,plotId});
   if(mounted.current){if(result.created)notifications.created('Carregamento vinculado ao contrato. Preencha o ATR quando disponível.');else notifications.saved('Este conjunto já está vinculado ao contrato.');onClose();}
  }catch(reason){if(mounted.current){setError((reason as Error).message);notifications.error((reason as Error).message);}}finally{busy.current=false;}
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!mutation.isPending)onClose();}}><DialogContent className="form-modal" showCloseButton={!mutation.isPending} onCloseAutoFocus={event=>{event.preventDefault();returnFocus();}} onEscapeKeyDown={event=>{if(mutation.isPending)event.preventDefault();}} onPointerDownOutside={event=>event.preventDefault()}>
  <DialogHeader><DialogTitle>Vincular carregamento do PDF</DialogTitle><DialogDescription>{candidate.sourceName} · {formatContractDate(candidate.loadedAt)} · {formatCandidateVolume(candidate.volume)}</DialogDescription></DialogHeader>
  <form className="client-form" onSubmit={submit}><fieldset className="company-fieldset" disabled={mutation.isPending}>
   <p className="field-help">Contrato {contract.contractNumber||contract.title}. Confira a origem: código da fazenda {candidate.farmCode||'—'}, talhão {candidate.plotCode||'—'}. A quantidade vem do PDF; o ATR ficará pendente no contrato.</p>
   <Field label="Fazenda de origem *"><Choice label="Selecione a fazenda cadastrada" value={farmId} onChange={value=>{setFarmId(value);setPlotId('');}} disabled={farms.loading} items={farms.farms.map(farm=>({value:farm.id,label:farm.name}))}/></Field>
   <Field label="Talhão (opcional)"><Choice label="Sem talhão" value={plotId||'__none__'} onChange={value=>setPlotId(value==='__none__'?'':value)} disabled={!farmId||plots.loading} items={[{value:'__none__',label:'Sem talhão'},...(plots.data?.plots??[]).map(plot=>({value:plot.id,label:plot.name}))]}/></Field>
   {(farms.error||plots.error)&&<p role="alert" className="form-error">{farms.error||plots.error}</p>}
  </fieldset>{error&&<p role="alert" className="form-error">{error}</p>}<div className="form-actions"><button type="button" className="btn" disabled={mutation.isPending} onClick={onClose}>Cancelar</button><button type="submit" className="btn company-primary" disabled={mutation.isPending||!farmId||!!farms.error}>{mutation.isPending?<Loader2 size={16} className="animate-spin"/>:<Link2 size={16}/>}Vincular ao contrato</button></div></form>
 </DialogContent></Dialog>;
}
