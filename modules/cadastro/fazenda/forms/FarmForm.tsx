import {useEffect,useRef,useState} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Choice,Field} from '@/shared/components/Common';
import {brazilStates} from '../utils/farmFields';
import type {Farm,FarmInput} from '../types';
export function FarmForm({farm,onSave,onClose,onBusy}:{farm?:Farm;onSave:(input:FarmInput,id?:string)=>Promise<void>;onClose:()=>void;onBusy:(busy:boolean)=>void}){
  const [state,setState]=useState(farm?.state||'');const [saving,setSaving]=useState(false);const [error,setError]=useState('');const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  return <form onSubmit={async event=>{event.preventDefault();if(saving)return;setError('');const form=new FormData(event.currentTarget);try{const input:FarmInput={name:String(form.get('name')??''),areaHa:String(form.get('areaHa')??''),city:String(form.get('city')??''),state};setSaving(true);onBusy(true);await onSave(input,farm?.id);if(mounted.current)onClose();}catch(error){if(mounted.current)setError((error as Error).message);}finally{if(mounted.current){setSaving(false);onBusy(false);}}}}>
    <fieldset className="company-fieldset" disabled={saving}><Field label="Nome da fazenda"><input name="name" required minLength={2} maxLength={150} defaultValue={farm?.name} placeholder="Ex.: Fazenda Boa Vista" autoFocus/></Field><Field label="Área em hectares"><div className="farm-area-input"><input name="areaHa" required inputMode="decimal" maxLength={16} defaultValue={farm?.areaHa.replace('.',',')} placeholder="Ex.: 125,50"/><span aria-hidden="true">ha</span></div></Field><div className="form-grid farm-location-grid"><Field label="Cidade"><input name="city" required minLength={2} maxLength={100} defaultValue={farm?.city} placeholder="Nome da cidade" autoComplete="address-level2"/></Field><Field label="UF"><Choice label="UF da fazenda" value={state} onChange={setState} items={brazilStates.map(value=>({value,label:value}))}/></Field></div></fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button><button className="btn company-primary" disabled={saving}>{saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>} {saving?'Salvando…':farm?'Salvar alterações':'Cadastrar fazenda'}</button></div>
  </form>;
}
