'use client';

import {useState,type FormEvent} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import type {PaymentMethod,PaymentMethodInput} from '../types';

export function PaymentMethodForm({method,onClose,onSave}:{method?:PaymentMethod;onClose:()=>void;onSave:(input:PaymentMethodInput)=>Promise<PaymentMethod>}){
  const [name,setName]=useState(method?.name??'');
  const [description,setDescription]=useState(method?.description??'');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    const normalized=name.trim();
    if(normalized.length<2){setError('Informe um nome com pelo menos 2 caracteres.');return;}
    setSaving(true);setError('');
    try{await onSave({id:method?.id,name:normalized,description:description.trim()});}
    catch(reason){const message=(reason as Error).message||'Não foi possível salvar a forma de pagamento.';setError(message);notifications.error(message);setSaving(false);}
  };
  return <Dialog open onOpenChange={open=>{if(!open&&!saving)onClose();}}><DialogContent className="form-modal payment-method-modal" showCloseButton={!saving} onEscapeKeyDown={event=>{if(saving)event.preventDefault();}} onPointerDownOutside={event=>{if(saving)event.preventDefault();}}><DialogHeader><DialogTitle>{method?'Editar forma de pagamento':'Cadastrar forma de pagamento'}</DialogTitle><DialogDescription>Crie uma opção reutilizável para selecionar nos pedidos de compra.</DialogDescription></DialogHeader><form onSubmit={event=>void submit(event)}><fieldset disabled={saving} className="payment-method-form"><Field label="Nome *"><input autoFocus required minLength={2} maxLength={100} value={name} onChange={event=>{setName(event.target.value);setError('');}} placeholder="Ex.: 30/60 dias" aria-invalid={!!error}/></Field><Field label="Descrição (opcional)"><textarea rows={3} maxLength={300} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Ex.: Parcelas iguais por boleto"/></Field></fieldset>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button><button type="submit" className="btn company-primary" disabled={saving}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?'Salvando…':method?'Salvar alterações':'Cadastrar forma'}</button></div></form></DialogContent></Dialog>;
}
