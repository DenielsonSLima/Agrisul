import {useId,useState} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Checkbox} from '@/components/ui/checkbox';
import {Textarea} from '@/components/ui/textarea';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {permissionGroups,type AccessProfile,type AccessProfileInput} from '../types';

export function AccessProfileForm({profile,onSave,onClose,onBusy}:{profile?:AccessProfile;onSave:(input:AccessProfileInput,id?:string)=>Promise<unknown>;onClose:()=>void;onBusy:(busy:boolean)=>void}){
  const prefix=useId();const [permissions,setPermissions]=useState(()=>new Set(profile?.permissions??[]));const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const toggle=(key:string,checked:boolean)=>setPermissions(current=>{
    const next=new Set(current);
    const requiredReads:Record<string,string[]>= {
      'companies.write':['companies.read'],'registrations.write':['registrations.read'],
      'contracts.write':['contracts.read'],'watermarks.write':['watermarks.read'],
      'report-headers.write':['report-headers.read','companies.read','watermarks.read'],
      'report-headers.read':['companies.read','watermarks.read'],
    };
    const writeForRead:Record<string,string>={'companies.read':'companies.write','registrations.read':'registrations.write','contracts.read':'contracts.write','watermarks.read':'watermarks.write','report-headers.read':'report-headers.write'};
    if(checked){next.add(key);requiredReads[key]?.forEach(permission=>next.add(permission));}
    else{
      next.delete(key);const dependent=writeForRead[key];if(dependent)next.delete(dependent);
      if(key==='companies.read'||key==='watermarks.read'){next.delete('report-headers.read');next.delete('report-headers.write');}
    }
    return next;
  });
  return <form onSubmit={async event=>{event.preventDefault();if(saving)return;const data=new FormData(event.currentTarget);setError('');setSaving(true);onBusy(true);try{if(!permissions.size)throw new Error('Selecione pelo menos uma permissão.');await onSave({name:String(data.get('name')??''),description:String(data.get('description')??''),permissions:[...permissions]},profile?.id);if(profile)notifications.updated('O perfil de acesso foi atualizado.');else notifications.created('O perfil de acesso foi cadastrado.');onClose();}catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}finally{setSaving(false);onBusy(false);}}}>
    <fieldset disabled={saving} className="company-fieldset"><Field label="Nome do perfil"><input name="name" required minLength={2} maxLength={100} defaultValue={profile?.name} autoFocus placeholder="Ex.: Financeiro"/></Field><Field label="Descrição (opcional)"><Textarea name="description" maxLength={500} rows={3} defaultValue={profile?.description} placeholder="Explique quando este perfil deve ser usado."/></Field>
      <fieldset className="settings-section"><legend><strong>Permissões</strong></legend><p className="field-help">Marque somente as ações necessárias para este perfil.</p><div className="grid gap-4 sm:grid-cols-2">{permissionGroups.map(group=><section key={group.label} className="rounded-lg border p-4"><h3 className="mb-3 text-sm font-semibold">{group.label}</h3><div className="grid gap-3">{group.options.map(option=>{const id=`${prefix}-${option.key}`;return <label key={option.key} htmlFor={id} className="flex items-center gap-2 text-sm"><Checkbox id={id} checked={permissions.has(option.key)} onCheckedChange={checked=>toggle(option.key,checked===true)}/><span>{option.label}</span></label>;})}</div></section>)}</div></fieldset>
    </fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button><button className="btn company-primary" disabled={saving}>{saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>} {saving?'Salvando…':profile?'Salvar alterações':'Cadastrar perfil'}</button></div>
  </form>;
}
