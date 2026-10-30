'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import type {Employee,EmployeeInput} from '../types';

export function EmployeeForm({employee,onClose,onSave}:{employee?:Employee;onClose:()=>void;onSave:(input:EmployeeInput)=>Promise<Employee>}){
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [fullName,setFullName]=useState(employee?.fullName??'');
  const [registrationNumber,setRegistrationNumber]=useState(employee?.registrationNumber??'');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');

  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    setSaving(true);setError('');
    try{await onSave({id:employee?.id,fullName,registrationNumber});}
    catch(reason){
      if(!mounted.current)return;
      const message=reason instanceof Error?reason.message:'Não foi possível salvar o funcionário.';
      setError(message);notifications.error(message);setSaving(false);
    }
  };

  return <Dialog open onOpenChange={open=>{if(!open&&!saving)onClose();}}>
    <DialogContent className="form-modal employee-modal" showCloseButton={!saving}
      onEscapeKeyDown={event=>{if(saving)event.preventDefault();}}
      onPointerDownOutside={event=>{if(saving)event.preventDefault();}}>
      <DialogHeader>
        <DialogTitle>{employee?'Editar funcionário':'Cadastrar funcionário'}</DialogTitle>
        <DialogDescription>Informe o nome completo e a matrícula do funcionário.</DialogDescription>
      </DialogHeader>
      <form onSubmit={event=>void submit(event)}>
        <fieldset disabled={saving} className="employee-form">
          <Field label="Nome completo *"><input autoFocus required minLength={2} maxLength={160} autoComplete="name"
            value={fullName} onChange={event=>{setFullName(event.target.value);setError('');}}
            placeholder="Ex.: Maria Aparecida Santos"/></Field>
          <Field label="Matrícula *"><input required maxLength={60} type="text" autoComplete="off"
            value={registrationNumber} onChange={event=>{setRegistrationNumber(event.target.value);setError('');}}
            placeholder="Ex.: 00123"/></Field>
        </fieldset>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn company-primary" disabled={saving}>
            {saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>}
            {saving?'Salvando…':employee?'Salvar alterações':'Cadastrar funcionário'}
          </button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
