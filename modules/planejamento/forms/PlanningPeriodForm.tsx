import {useMemo,useState} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import type {Culture} from '@/modules/cadastro/culturas/types';
import type {PlanningPeriod,PlanningPeriodInput,PlanningStatus} from '../types';

export function PlanningPeriodForm({period,cultures,onSave,onClose}:{
 period?:PlanningPeriod;cultures:Culture[];onSave:(input:PlanningPeriodInput)=>Promise<void>;onClose:()=>void;
}){
 const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 const [cultureId,setCultureId]=useState(period?.cultureId??cultures[0]?.id??'');
 const culture=useMemo(()=>cultures.find(item=>item.id===cultureId),[cultures,cultureId]);
 const [subtypeId,setSubtypeId]=useState(period?.cultureSubtypeId??culture?.subtypes[0]?.id??'');
 const changeCulture=(id:string)=>{setCultureId(id);setSubtypeId(cultures.find(item=>item.id===id)?.subtypes[0]?.id??'');};
 return <form onSubmit={async event=>{
  event.preventDefault();if(saving)return;setError('');const form=new FormData(event.currentTarget);
  const input:PlanningPeriodInput={name:String(form.get('name')??''),startDate:String(form.get('startDate')??''),endDate:String(form.get('endDate')??''),targetAreaHa:String(form.get('targetAreaHa')??''),cultureId,cultureSubtypeId:subtypeId,notes:String(form.get('notes')??''),status:String(form.get('status')??'active') as PlanningStatus,revisionReason:period?String(form.get('revisionReason')??''):undefined};
  try{setSaving(true);await onSave(input);onClose();}catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}finally{setSaving(false);}
 }}>
  <fieldset disabled={saving} className="company-fieldset"><div className="form-grid">
   <Field label="Nome da safra"><input name="name" required minLength={2} maxLength={160} defaultValue={period?.name} placeholder="Ex.: Safra 2026/2027 ou Inverno 2026" autoFocus/></Field>
   <Field label="Meta de novo plantio"><div className="farm-area-input"><input name="targetAreaHa" required inputMode="decimal" maxLength={16} defaultValue={period?.targetAreaHa.replace('.',',')} placeholder="Ex.: 20"/><span>ha</span></div></Field>
   <Field label="Início"><input name="startDate" type="date" required defaultValue={period?.startDate}/></Field>
   <Field label="Fim"><input name="endDate" type="date" required defaultValue={period?.endDate}/></Field>
   <Field label="Cultura"><select className="planning-select" value={cultureId} onChange={event=>changeCulture(event.target.value)} required><option value="">Selecione</option>{cultures.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
   <Field label="Ciclo"><select className="planning-select" value={subtypeId} onChange={event=>setSubtypeId(event.target.value)} required disabled={!cultureId}><option value="">Selecione</option>{(culture?.subtypes??[]).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
   {period&&<Field label="Situação"><select name="status" className="planning-select" defaultValue={period.status}><option value="active">Ativo</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select></Field>}
  </div>
  <Field label="Observações"><textarea name="notes" className="planning-textarea" maxLength={2000} defaultValue={period?.notes} placeholder="Informações gerais da safra e do período"/></Field>
  {period&&<Field label="Motivo da alteração"><input name="revisionReason" required minLength={3} maxLength={500} placeholder="Explique o que mudou"/></Field>}
  </fieldset>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="form-actions"><button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button><button className="btn company-primary" disabled={saving||!cultureId||!subtypeId}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?'Salvando…':period?'Salvar alterações':'Criar safra'}</button></div>
 </form>;
}
