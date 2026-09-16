import {useEffect,useRef,useState} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {formatHectares} from '@/modules/cadastro/fazenda/utils/farmFormat';
import type {Plot,PlotInput} from '../types';
export function PlotForm({plot,maxAreaHa,onSave,onClose,onBusy}:{plot?:Plot;maxAreaHa:string;onSave:(input:PlotInput,id?:string)=>Promise<void>;onClose:()=>void;onBusy:(busy:boolean)=>void}){
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  return <form onSubmit={async event=>{event.preventDefault();if(saving)return;setError('');const form=new FormData(event.currentTarget);try{const input:PlotInput={name:String(form.get('name')??''),areaHa:String(form.get('areaHa')??'')};setSaving(true);onBusy(true);await onSave(input,plot?.id);if(mounted.current)onClose();}catch(error){if(mounted.current)setError((error as Error).message);}finally{if(mounted.current){setSaving(false);onBusy(false);}}}}>
    <p className="plot-available">Disponível para este talhão: <strong>{formatHectares(maxAreaHa)} ha</strong></p><fieldset disabled={saving} className="company-fieldset"><Field label="Nome do talhão"><input name="name" required minLength={2} maxLength={150} defaultValue={plot?.name} placeholder="Ex.: Talhão 1" autoFocus/></Field><Field label="Área em hectares"><div className="farm-area-input"><input name="areaHa" required inputMode="decimal" maxLength={16} defaultValue={plot?.areaHa.replace('.',',')} placeholder="Ex.: 3,33"/><span aria-hidden="true">ha</span></div></Field></fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="btn" type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className="btn company-primary" disabled={saving}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?'Salvando…':plot?'Salvar alterações':'Cadastrar talhão'}</button></div>
  </form>;
}
