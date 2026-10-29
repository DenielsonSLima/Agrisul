import {useEffect,useRef,useState} from 'react';
import {FileCheck2,Link2,Loader2} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Choice,Field} from '@/shared/components/Common';
import {importDocumentHref} from '@/modules/importacoes/navigation';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {notifications} from '@/shared/feedback';
import {useFarms} from '@/modules/cadastro/fazenda/hooks/useFarms';
import {usePlots} from '@/modules/cadastro/talhoes/hooks/usePlots';
import {useImportedLoads,useLinkImportedLoad,useImportedAtrPreview,type ImportedLoadCandidate,type ImportedAtrInput} from '../../hooks/useImportedLoads';
import {ImportedLoadAtrFields} from './ImportedLoadAtrFields';
import type {BillingContract} from '../../types';
import {formatContractDate} from '../../utils/contractFormat';

const volumeFormatter=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3});
const formatCandidateVolume=(value:string|null|undefined)=>value==null?'—':volumeFormatter.format(Number(value))+' t';
const candidateGroupLabel=(candidate:ImportedLoadCandidate)=>candidate.groupOrdinal==null?'Lançamento avulso':`Conjunto ${candidate.groupOrdinal}`;
function groupCandidates(loads:ImportedLoadCandidate[]){
 const groups=new Map<string,{key:string;source:ImportedLoadCandidate;origins:ImportedLoadCandidate[]}>();
 for(const candidate of loads){
  const key=JSON.stringify([candidate.documentId,candidate.groupKey]);
  const group=groups.get(key);
  if(group)group.origins.push(candidate);
  else groups.set(key,{key,source:candidate,origins:[candidate]});
 }
 return [...groups.values()];
}

export function ImportedLoadsQueue({contract}:{contract:BillingContract}){
 const query=useImportedLoads(contract.companyId,contract.id);
 const [selected,setSelected]=useState<ImportedLoadCandidate|null>(null);
 const trigger=useRef<HTMLElement|null>(null);
 const groups=groupCandidates(query.data?.loads??[]);
 return <section className="loads-results imported-loads-queue" aria-label="Carregamentos dos PDFs finalizados" aria-busy={query.loading}>
  <header className="loads-results-heading"><div><h3><FileCheck2 size={18}/> PDFs prontos para vincular</h3><span>Documentos finalizados do parceiro e da colheita deste contrato · volume líquido por conjunto · ATR por parte ou média geral</span></div><span>{query.data?`${groups.length} ${groups.length===1?'conjunto':'conjuntos'} · ${query.data.loads.length} ${query.data.loads.length===1?'origem':'origens'}`:'—'}</span></header>
  {query.loading?<p className="imported-loads-state" role="status"><Loader2 size={16} className="animate-spin"/> Consultando documentos finalizados…</p>:query.error?<p className="imported-loads-state" role="alert">{query.error} <button type="button" className="btn" onClick={()=>void query.reload()}>Tentar novamente</button></p>:!query.data?.loads.length?<p className="imported-loads-state">Ao finalizar um PDF nas Importações, os conjuntos deste parceiro com a colheita deste contrato aparecem aqui para vinculação.</p>:<>
   <p className="imported-loads-volume-help">O volume líquido soma o peso bruto menos a tara de todas as linhas do conjunto. Vincule as origens abaixo; cada vínculo usa o volume da sua origem.</p>
   <div className="imported-loads-groups">{groups.map(group=><article className="loads-group imported-loads-group" key={group.key} data-imported-load-group={group.key}>
    <header className="imported-loads-group-heading"><div><h4>{candidateGroupLabel(group.source)} · Entrada {group.source.entryNumber||'sem número'} · {formatContractDate(group.source.loadedAt)}</h4><p>{group.source.sourceName}</p><small>{group.source.groupEntryCount} linha(s) no PDF · {group.origins.length} origem(ns) aguardando vínculo</small></div><div className="imported-loads-group-total"><span>Volume líquido do conjunto</span><strong data-group-volume={group.source.groupVolume??''}>{formatCandidateVolume(group.source.groupVolume)}</strong></div></header>
    <div className="loads-table-wrap"><table className="loads-table imported-loads-table"><caption className="sr-only">Origens de {candidateGroupLabel(group.source).toLowerCase()}, entrada {group.source.entryNumber||'sem número'}</caption><thead><tr><th scope="col">Origem do PDF</th><th scope="col">Colheita</th><th scope="col" className="numeric">Volume da origem (t)</th><th scope="col">Vínculo</th></tr></thead><tbody>{group.origins.map(candidate=><tr key={candidate.tripKey} data-load-origin={candidate.tripKey}>
    <td data-label="Origem do PDF"><strong>Fazenda {candidate.farmCode||'—'} · Talhão {candidate.plotCode||'—'}</strong><small>{candidate.entryCount} linha(s) nesta origem</small></td>
    <td data-label="Colheita">{candidate.harvestMethod==='1'?'Manual':candidate.harvestMethod==='2'?'Mecanizada':'Conferir coluna K'}</td>
    <td data-label="Volume da origem (t)" className="numeric">{formatCandidateVolume(candidate.volume)}</td>
    <td data-label="Vínculo">{candidate.issue?<><span className="loads-money-pending">{candidate.issue}</span><ModuleLink className="btn small" href={importDocumentHref(candidate.documentId,{tab:'finished'})}>Abrir PDF</ModuleLink></>:query.data?.canManage&&contract.status==='Ativo'?<button type="button" className="btn small company-primary" aria-label={`Vincular ${candidateGroupLabel(candidate).toLowerCase()}, entrada ${candidate.entryNumber||'sem número'}, fazenda ${candidate.farmCode||'não informada'}, talhão ${candidate.plotCode||'não informado'}`} onClick={()=>{trigger.current=document.activeElement as HTMLElement;setSelected(candidate);}}><Link2 size={14}/>Vincular</button>:<span>Somente consulta</span>}</td>
   </tr>)}</tbody></table></div>
   </article>)}</div>
  </>}
  {selected&&<LinkImportedLoadDialog key={selected.documentId+selected.tripKey} candidate={selected} contract={contract} onClose={()=>setSelected(null)} returnFocus={()=>trigger.current?.isConnected&&trigger.current.focus()}/>}
 </section>;
}
function LinkImportedLoadDialog({candidate,contract,onClose,returnFocus}:{candidate:ImportedLoadCandidate;contract:BillingContract;onClose:()=>void;returnFocus:()=>void}){
 const farms=useFarms(),mutation=useLinkImportedLoad();
 const [atrInput,setAtrInput]=useState<ImportedAtrInput>(()=>({atrMode:candidate.parts?.some(part=>!!part.atr)?'source':'pending',atr:'',atrParts:[]}));
 const atrPreview=useImportedAtrPreview({companyId:contract.companyId,contractId:contract.id,id:candidate.documentId,tripKey:candidate.tripKey,expectedUpdatedAt:candidate.updatedAt},atrInput);
 const [farmId,setFarmId]=useState(candidate.matchedFarmId??''),[plotId,setPlotId]=useState(candidate.matchedPlotId??''),[error,setError]=useState('');
 const plots=usePlots(farmId);
 const farmUnavailable=!!farmId&&!farms.loading&&!farms.error&&!farms.farms.some(farm=>farm.id===farmId);
 const plotUnavailable=!!plotId&&!plots.loading&&!plots.error&&!plots.data?.plots.some(plot=>plot.id===plotId);
 const farmHelp=farmUnavailable?'A fazenda selecionada não está mais disponível. Selecione outra fazenda.':farmId
  ?farmId===candidate.matchedFarmId?'Fazenda reconhecida pelo código do PDF e já selecionada. Você pode alterá-la.':'Fazenda selecionada manualmente. Confira o código de origem do PDF.'
  :candidate.farmMatchStatus==='ambiguous'?'Há mais de uma fazenda com este código. Selecione a fazenda correta.'
  :candidate.farmMatchStatus==='missing-code'?'O PDF está sem código de fazenda. Selecione a fazenda cadastrada.'
  :'Nenhuma fazenda foi reconhecida pelo código do PDF. Selecione a fazenda cadastrada.';
 const plotHelp=plotUnavailable?'O talhão selecionado não está mais disponível nesta fazenda. Selecione outro talhão ou mantenha sem talhão.':plotId
  ?farmId===candidate.matchedFarmId&&plotId===candidate.matchedPlotId?'Talhão reconhecido na fazenda do PDF e já selecionado. Você pode alterá-lo.':'Talhão selecionado manualmente. Confira a origem do PDF.'
  :!farmId?'Selecione a fazenda para consultar seus talhões.'
  :farmId!==candidate.matchedFarmId?'Selecione o talhão desta fazenda, se houver.'
  :candidate.plotMatchStatus==='ambiguous'?'Há mais de um talhão correspondente nesta fazenda. Selecione o talhão correto.'
  :candidate.plotMatchStatus==='missing-code'?'O PDF está sem talhão. Você pode selecionar um ou manter sem talhão.'
  :candidate.plotMatchStatus==='matched'?'Você pode selecionar o talhão reconhecido ou manter sem talhão.'
  :'Nenhum talhão foi reconhecido nesta fazenda. Selecione um ou mantenha sem talhão.';
 const mounted=useRef(true),busy=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const submit=async(event:React.FormEvent)=>{event.preventDefault();if(busy.current)return;busy.current=true;setError('');
  try{const result=await mutation.mutateAsync({companyId:contract.companyId,contractId:contract.id,id:candidate.documentId,tripKey:candidate.tripKey,expectedUpdatedAt:candidate.updatedAt,farmId,plotId,...atrInput});
   if(mounted.current){if(result.created)notifications.created(result.load.atr?'Carregamento vinculado com ATR. Os indicadores foram atualizados.':'Carregamento vinculado. O ATR pode ser informado depois.');else notifications.saved('Esta origem já está vinculada ao contrato.');onClose();}
  }catch(reason){if(mounted.current){setError((reason as Error).message);notifications.error((reason as Error).message);}}finally{busy.current=false;}
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!mutation.isPending)onClose();}}><DialogContent className="form-modal" showCloseButton={!mutation.isPending} onCloseAutoFocus={event=>{event.preventDefault();returnFocus();}} onEscapeKeyDown={event=>{if(mutation.isPending)event.preventDefault();}} onPointerDownOutside={event=>event.preventDefault()}>
  <DialogHeader><DialogTitle>Vincular carregamento do PDF</DialogTitle><DialogDescription>{candidate.sourceName} · {formatContractDate(candidate.loadedAt)} · {candidateGroupLabel(candidate)} · {formatCandidateVolume(candidate.volume)} desta origem</DialogDescription></DialogHeader>
  <form className="client-form" onSubmit={submit}><fieldset className="company-fieldset" disabled={mutation.isPending}>
   <p className="field-help">Contrato {contract.contractNumber||contract.title}. Confira a origem: código da fazenda {candidate.farmCode||'—'}, talhão {candidate.plotCode||'—'}. O vínculo usa {formatCandidateVolume(candidate.volume)} desta origem. Informe o ATR abaixo ou deixe pendente.{candidate.groupOriginCount>1&&` O conjunto completo tem ${formatCandidateVolume(candidate.groupVolume)}, distribuídas em ${candidate.groupOriginCount} origens.`}</p>
   <Field label="Fazenda de origem *"><Choice label="Selecione a fazenda cadastrada" value={farmId} onChange={value=>{setFarmId(value);setPlotId('');}} disabled={farms.loading} items={farms.farms.map(farm=>({value:farm.id,label:farm.code?`${farm.code} · ${farm.name}`:farm.name}))}/><small role={farmUnavailable?'alert':undefined}>{farms.loading?'Consultando fazendas cadastradas…':farmHelp}</small></Field>
   <Field label="Talhão (opcional)"><Choice label="Sem talhão" value={plotId||'__none__'} onChange={value=>setPlotId(value==='__none__'?'':value)} disabled={!farmId||farmUnavailable||plots.loading} items={[{value:'__none__',label:'Sem talhão'},...(plots.data?.plots??[]).map(plot=>({value:plot.id,label:plot.name}))]}/><small role={plotUnavailable?'alert':undefined}>{plots.loading?'Consultando talhões da fazenda…':plotHelp}</small></Field>
   <ImportedLoadAtrFields parts={candidate.parts??[]} value={atrInput} onChange={setAtrInput} preview={atrPreview}/>
   {(farms.error||plots.error)&&<p role="alert" className="form-error">{farms.error||plots.error}</p>}
  </fieldset>{error&&<p role="alert" className="form-error">{error}</p>}<div className="form-actions"><button type="button" className="btn" disabled={mutation.isPending} onClick={onClose}>Cancelar</button><button type="submit" className="btn company-primary" disabled={mutation.isPending||!farmId||farms.loading||plots.loading||!!farms.error||!!plots.error||farmUnavailable||plotUnavailable||atrPreview.loading||!atrPreview.complete||!!atrPreview.error}>{mutation.isPending?<Loader2 size={16} className="animate-spin"/>:<Link2 size={16}/>}Vincular ao contrato</button></div></form>
 </DialogContent></Dialog>;
}
