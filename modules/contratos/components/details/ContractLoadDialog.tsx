import {useEffect,useRef,useState} from 'react';
import {Loader2,Plus,Save,TriangleAlert,Truck} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Textarea} from '@/components/ui/textarea';
import {Choice,Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {useFarms} from '@/modules/cadastro/fazenda/hooks/useFarms';
import {usePlots} from '@/modules/cadastro/talhoes/hooks/usePlots';
import {useContractLoadsMutation} from '../../hooks/useContracts';
import {formatAtrCriterion,formatContractVolume,previewContractLoadExcess} from '../../utils/contractFormat';
import type {BillingContract,ContractLoad,ContractLoadInput} from '../../types';
import {QuickOriginDialog} from './QuickOriginDialog';

const today=()=>{const date=new Date();return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');};
export function ContractLoadDialog({contract,load,onClose,returnFocus}:{contract:BillingContract;load?:ContractLoad;onClose:()=>void;returnFocus:()=>void}){
 const farms=useFarms(),mutation=useContractLoadsMutation();
 const mounted=useRef(true),inFlight=useRef(false),originTrigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const [data,setData]=useState<ContractLoadInput>(()=>load?{loadedAt:load.loadedAt,farmId:load.farmId,plotId:load.plotId,volume:load.volume,atr:load.atr,document:load.document,notes:load.notes}:{loadedAt:today(),farmId:'',plotId:'',volume:'',atr:'',document:'',notes:''});
 const [error,setError]=useState(''),[originOpen,setOriginOpen]=useState(false);const plots=usePlots(data.farmId);
 const plotChoiceValue=data.farmId?(data.plotId||'__without_plot__'):'';
 const excessVolume=previewContractLoadExcess(contract.contractedVolume,contract.loadedVolume,data.volume,load?.volume??'0');
 const set=(key:keyof ContractLoadInput,value:string)=>setData(current=>({...current,[key]:value}));
 const save=async(event:React.FormEvent)=>{
  event.preventDefault();if(inFlight.current)return;inFlight.current=true;setError('');
  try{
   await mutation.save(contract.id,data,load?.id);
   if(!mounted.current)return;
   if(load)notifications.updated('O carregamento e os indicadores foram atualizados.');
   else notifications.created('O carregamento foi lançado e os indicadores foram atualizados.');
   onClose();
  }catch(reason){if(mounted.current){const message=(reason as Error).message;setError(message);notifications.error(message);}}finally{inFlight.current=false;}
 };
 const sourceError=farms.error;
 return <Dialog open onOpenChange={open=>{if(!open&&!mutation.saving)onClose();}}>
  <DialogContent className="form-modal contract-load-modal" showCloseButton={!mutation.saving} onCloseAutoFocus={e=>{e.preventDefault();returnFocus();}} onEscapeKeyDown={e=>{if(mutation.saving)e.preventDefault();}} onPointerDownOutside={e=>e.preventDefault()}>
   <DialogHeader><DialogTitle><Truck size={20}/>{load?'Editar carregamento':'Novo carregamento'}</DialogTitle><DialogDescription>Registre a data, a origem e a quantidade líquida em toneladas.</DialogDescription></DialogHeader>
   <form className="client-form contract-load-form" onSubmit={save}>
    <fieldset className="company-fieldset" disabled={mutation.saving}>
     <section className="client-form-section">
      <div className="form-grid">
       <Field label="Data do carregamento *"><input name="loadedAt" required type="date" min="1900-01-01" max="9999-12-31" value={data.loadedAt} onChange={e=>set('loadedAt',e.target.value)}/></Field>
       <Field label="Quantidade líquida (t) *"><input name="volume" required inputMode="decimal" maxLength={18} placeholder="Ex.: 32,750" value={data.volume} onChange={e=>set('volume',e.target.value)}/></Field>
      </div>
      <div className="form-grid">
       <div className="field contract-origin-field"><span>Fazenda de origem *</span><div className="contract-origin-input"><Choice label={farms.loading?'Carregando fazendas':'Selecione a fazenda'} value={data.farmId} onChange={value=>setData(current=>({...current,farmId:value,plotId:''}))} disabled={farms.loading} items={farms.farms.map(f=>({value:f.id,label:f.name,description:`${f.city} / ${f.state}`}))}/><button ref={originTrigger} type="button" className="btn contract-origin-add" aria-label="Cadastrar nova fazenda e talhão" title="Cadastrar nova fazenda e talhão" onClick={()=>setOriginOpen(true)}><Plus size={18}/></button></div></div>
       <Field label="Talhão de origem (opcional)"><Choice label={!data.farmId?'Selecione a fazenda primeiro':plots.loading?'Carregando talhões':'Sem talhão'} value={plotChoiceValue} onChange={value=>set('plotId',value==='__without_plot__'?'':value)} disabled={!data.farmId||plots.loading} items={[{value:'__without_plot__',label:'Sem talhão'},...(plots.data?.plots??[]).map(p=>({value:p.id,label:p.name}))]}/></Field>
      </div>
      {sourceError&&<p className="form-error" role="alert">{sourceError} <button className="btn" type="button" onClick={()=>{void farms.reload();}}>Tentar novamente</button></p>}
      {plots.error&&<p className="contract-origin-notice" role="status">Não foi possível carregar os talhões. Você pode continuar sem talhão. <button className="btn" type="button" onClick={()=>{void plots.reload();}}>Tentar novamente</button></p>}
      {!farms.loading&&!farms.error&&!farms.farms.length&&<p className="contract-origin-help">Use o botão + para cadastrar a primeira fazenda sem sair deste carregamento.</p>}
      {!!data.farmId&&!plots.loading&&!plots.error&&!plots.data?.plots.length&&<p className="contract-origin-notice" role="status">Esta fazenda ainda não possui talhões. Você pode continuar sem talhão ou cadastrá-lo pelo botão +.</p>}
      <div className="form-grid">
       <Field label="ATR do carregamento (kg/t) *"><input name="atr" required inputMode="decimal" maxLength={18} placeholder="Ex.: 121,500000" value={data.atr} onChange={e=>set('atr',e.target.value)}/><small>Informe o ATR medido neste carregamento.</small></Field>
       <Field label="Documento (opcional)"><input name="document" maxLength={100} placeholder="Ticket, romaneio ou nota" value={data.document} onChange={e=>set('document',e.target.value)}/></Field>
      </div>
      <p className="field-help">Faturamento = quantidade (t) × ATR do carregamento (kg/t) × cotação (R$/kg). A cotação será {formatAtrCriterion(contract.atrPriceType,contract.atrPeriodType)}, do mesmo mês ou, enquanto ausente, do mês anterior.</p>
      {excessVolume>0&&<p className="contract-load-excess-warning" role="status"><TriangleAlert size={18}/><span><strong>O volume contratado será ultrapassado em {formatContractVolume(String(excessVolume))}.</strong> O carregamento poderá ser lançado e todo o excedente será incluído normalmente no faturamento.</span></p>}
      <Field label="Observações (opcional)"><Textarea name="notes" rows={3} maxLength={1000} placeholder="Informações adicionais sobre este carregamento" value={data.notes} onChange={e=>set('notes',e.target.value)}/></Field>
     </section>
    </fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="btn" type="button" disabled={mutation.saving} onClick={onClose}>Cancelar</button><button className="btn company-primary" type="submit" disabled={mutation.saving||!!sourceError||farms.loading||!data.farmId}>{mutation.saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>} {mutation.saving?'Salvando…':load?'Salvar alterações':'Lançar carregamento'}</button></div>
   </form>
   {originOpen&&<QuickOriginDialog onClose={()=>setOriginOpen(false)} returnFocus={()=>originTrigger.current?.focus()} onCreated={({farm,plot})=>{setData(current=>({...current,farmId:farm.id,plotId:plot?.id??''}));setError('');}}/>}
  </DialogContent>
 </Dialog>;
}
