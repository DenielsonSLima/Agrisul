import {useState} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {formatHectares} from '@/modules/cadastro/fazenda/utils/farmFormat';
import type {PlanningAllocation,PlanningAllocationInput,PlanningPlot} from '../types';

export function PlanningAllocationForm({plot,allocation,onSave,onClose}:{
 plot:PlanningPlot;allocation?:PlanningAllocation;onSave:(input:PlanningAllocationInput)=>Promise<void>;onClose:()=>void;
}){
 const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 return <form onSubmit={async event=>{event.preventDefault();if(saving)return;setError('');const form=new FormData(event.currentTarget);
  const input:PlanningAllocationInput={areaHa:String(form.get('areaHa')??''),notes:String(form.get('notes')??''),revisionReason:allocation?String(form.get('revisionReason')??''):undefined};
  try{setSaving(true);await onSave(input);onClose();}catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}finally{setSaving(false);}
 }}>
  <p className="plot-available">Limite deste plano no talhão: <strong>{formatHectares(plot.maxAllocationAreaHa)} ha</strong></p>
  <fieldset disabled={saving} className="company-fieldset"><Field label="Área planejada"><div className="farm-area-input"><input name="areaHa" required inputMode="decimal" maxLength={16} defaultValue={allocation?.areaHa.replace('.',',')} placeholder="Ex.: 10" autoFocus/><span>ha</span></div></Field><Field label="Observações"><textarea name="notes" className="planning-textarea" maxLength={2000} defaultValue={allocation?.notes} placeholder="Identificação da frente, variedade ou detalhe da área"/></Field>{allocation&&<Field label="Motivo da alteração"><input name="revisionReason" required minLength={3} maxLength={500} placeholder="Explique o ajuste da distribuição"/></Field>}</fieldset>
  {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button><button className="btn company-primary" disabled={saving}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?'Salvando…':allocation?'Salvar distribuição':'Adicionar ao plano'}</button></div>
 </form>;
}
