'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Loader2} from 'lucide-react';
import {notifications,useConfirmation} from '@/shared/feedback';
import {useImportHarvestOrders} from '../hooks/useImportacoes';
import type {ImportDocument,ImportHarvestOrderOptions,ImportHarvestOrdersInput} from '../types';
type HarvestOrdersProps={id:string;onClose:()=>void;saving:boolean;onSave:(input:ImportHarvestOrdersInput)=>Promise<{document:ImportDocument;changedCount:number}>};

export function ImportHarvestOrders({id,onClose,saving,onSave}:HarvestOrdersProps){
 const model=useImportHarvestOrders(id);
 return <section className="imports-bulk-panel imports-harvest-orders" aria-label="Ordens de colheita por talhão"><h2>Ordens de colheita por talhão</h2><p>Informe a ordem para cada fazenda e talhão. O preenchimento alcança todas as linhas deste documento, inclusive fora dos filtros. Deixe em branco para manter os valores atuais.</p>
 {model.loading?<p role="status"><Loader2 size={16} className="animate-spin"/>Carregando talhões…</p>:model.error?<div role="alert"><p className="form-error">{model.error}</p><button type="button" className="btn" onClick={()=>void model.reload()}>Tentar novamente</button></div>:model.data&&<HarvestOrdersForm id={id} latest={model.data} onClose={onClose} saving={saving} onSave={onSave}/>}
 {(model.loading||model.error)&&<button type="button" className="btn" onClick={onClose}>Fechar</button>}</section>;
}
function HarvestOrdersForm({id,latest,onClose,saving,onSave}:HarvestOrdersProps&{latest:ImportHarvestOrderOptions}){
 const [data]=useState(latest);const [values,setValues]=useState<Record<string,string>>({});const [error,setError]=useState('');const confirm=useConfirmation();const mounted=useRef(true);const stale=latest.updatedAt!==data.updatedAt;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const selected=data.orders.flatMap((row,index)=>values[index]?.trim()?[{farm:row.farm,plot:row.plot,order:values[index].trim()}]:[]);
 async function submit(event:FormEvent){
  event.preventDefault();if(saving||stale||!selected.length)return;setError('');
  const accepted=await confirm({title:'Aplicar ordens de colheita?',description:'As ordens informadas substituirão os valores de todas as linhas das fazendas e talhões preenchidos neste documento, inclusive fora dos filtros. As linhas alteradas precisarão de nova conferência.',confirmLabel:'Aplicar ordens'});
  if(!accepted||!mounted.current)return;
  try{const result=await onSave({id,expectedUpdatedAt:data.updatedAt,orders:selected});if(mounted.current){notifications.updated(`Ordens de colheita aplicadas em ${result.changedCount} linha(s).`);onClose();}}
  catch(reason){if(mounted.current){const text=reason instanceof Error?reason.message:'Não foi possível aplicar as ordens.';setError(text);notifications.error(text);}}
 }
 return <form onSubmit={event=>void submit(event)}><fieldset className="company-fieldset" disabled={saving}><div className="imports-table-wrap"><table className="imports-table"><thead><tr><th>Fazenda</th><th>Talhão</th><th>Linhas</th><th>Ordens atuais</th><th>Nova ordem de colheita</th></tr></thead><tbody>{data.orders.map((row,index)=><tr key={JSON.stringify([row.farm,row.plot])}><td>{row.farm}{row.farmName?` · ${row.farmName}`:''}</td><td>{row.plot}</td><td>{row.entryCount}</td><td>{row.currentOrders.map(value=>value||'Vazio').join(', ')}</td><td><input aria-label={`Ordem da fazenda ${row.farm}, talhão ${row.plot}`} inputMode="numeric" pattern="[0-9]{1,15}" maxLength={15} placeholder="Manter atual" value={values[index]??''} onChange={event=>setValues(current=>({...current,[index]:event.target.value}))}/></td></tr>)}</tbody></table></div>
 {!data.orders.length&&<p>Nenhuma linha com fazenda e talhão preenchidos.</p>}{data.missingCount>0&&<p className="imports-help">{data.missingCount} linha(s) sem fazenda ou talhão ficam de fora. Complete esses campos na tabela para incluí-las.</p>}
 </fieldset>{stale&&!saving&&<p className="form-error" role="alert">O documento mudou. Feche e reabra as ordens por talhão para conferir os dados atuais.</p>}{error&&<p className="form-error" role="alert">{error}</p>}<div className="imports-form-footer"><button type="button" className="btn" disabled={saving} onClick={onClose}>Fechar</button><button type="submit" className="btn company-primary" disabled={saving||stale||!selected.length}>{saving&&<Loader2 size={15} className="animate-spin"/>}Aplicar ordens por talhão</button></div></form>;
}
