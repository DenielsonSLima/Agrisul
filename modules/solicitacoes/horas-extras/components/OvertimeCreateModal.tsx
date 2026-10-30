'use client';
import {useState,type FormEvent} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import type {OvertimeCreateInput} from '../types';

export function OvertimeCreateModal({companyId,busy,error,onClose,onSave}:{companyId:string;busy:boolean;error:string;onClose:()=>void;onSave:(input:OvertimeCreateInput)=>Promise<void>}){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
 const [from,setFrom]=useState(today),[to,setTo]=useState(today),[notes,setNotes]=useState('');
 const submit=(event:FormEvent)=>{event.preventDefault();if(!busy)void onSave({companyId,dateFrom:from,dateTo:to,notes});};
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="form-modal overtime-create-modal" showCloseButton={!busy} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}>
  <DialogHeader><DialogTitle>Novo relatório de hora extra</DialogTitle><DialogDescription>Informe o período e a observação. Depois de salvar, inclua os funcionários e as horas.</DialogDescription></DialogHeader>
  <form onSubmit={submit}><fieldset disabled={busy} className="overtime-create-fields"><div><Field label="Data inicial *"><input autoFocus required type="date" value={from} onChange={event=>setFrom(event.target.value)}/></Field><Field label="Data final *"><input required type="date" value={to} onChange={event=>setTo(event.target.value)}/></Field></div><Field label="Observação"><textarea rows={4} maxLength={2000} placeholder="Informe uma observação para este relatório" value={notes} onChange={event=>setNotes(event.target.value)}/></Field></fieldset>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="btn company-primary" disabled={busy}>{busy?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>} {busy?'Salvando…':'Criar relatório'}</button></div></form>
 </DialogContent></Dialog>;
}
