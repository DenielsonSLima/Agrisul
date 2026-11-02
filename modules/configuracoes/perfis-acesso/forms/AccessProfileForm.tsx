import {useId,useState} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Checkbox} from '@/components/ui/checkbox';
import {Textarea} from '@/components/ui/textarea';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {toggleProfilePermissions} from '@/shared/access/permissionCatalog';
import {permissionGroups,type AccessProfile,type AccessProfileInput} from '../types';

export function AccessProfileForm({profile,onSave,onClose,onBusy}:{profile?:AccessProfile;onSave:(input:AccessProfileInput,id?:string)=>Promise<unknown>;onClose:()=>void;onBusy:(busy:boolean)=>void}){
  const prefix=useId();const [permissions,setPermissions]=useState(()=>new Set(profile?.permissions??[]));const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const toggle=(keys:string[],checked:boolean)=>setPermissions(current=>toggleProfilePermissions(current,keys,checked));
  return <form onSubmit={async event=>{event.preventDefault();if(saving)return;const data=new FormData(event.currentTarget);setError('');setSaving(true);onBusy(true);try{if(!permissions.size)throw new Error('Selecione pelo menos uma permissão.');await onSave({name:String(data.get('name')??''),description:String(data.get('description')??''),permissions:[...permissions]},profile?.id);if(profile)notifications.updated('O perfil de acesso foi atualizado.');else notifications.created('O perfil de acesso foi cadastrado.');onClose();}catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}finally{setSaving(false);onBusy(false);}}}>
    <fieldset disabled={saving} className="company-fieldset"><Field label="Nome do perfil"><input name="name" required minLength={2} maxLength={100} defaultValue={profile?.name} autoFocus placeholder="Ex.: Financeiro"/></Field><Field label="Descrição (opcional)"><Textarea name="description" maxLength={500} rows={3} defaultValue={profile?.description} placeholder="Explique quando este perfil deve ser usado."/></Field>
      <fieldset className="settings-section"><legend><strong>Permissões por módulo e submódulo</strong></legend><p className="field-help">Escolha as ações de cada submódulo. Por exemplo, Funcionários e Relatório de hora extra podem ser liberados separadamente dos demais cadastros e solicitações.</p><div className="grid gap-4">{permissionGroups.map(group=>{
        const keys=group.submodules.flatMap(submodule=>submodule.options.map(option=>option.key));
        const selected=keys.filter(key=>permissions.has(key)).length;
        const groupId=`${prefix}-${group.id}`;
        return <section key={group.id} className="rounded-lg border p-4" aria-labelledby={`${groupId}-title`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 id={`${groupId}-title`} className="text-sm font-semibold">{group.label}</h3><label htmlFor={`${groupId}-all`} className="flex min-h-11 items-center gap-2 text-sm"><Checkbox id={`${groupId}-all`} checked={selected===keys.length?true:selected?'indeterminate':false} onCheckedChange={checked=>toggle(keys,checked===true)}/><span>Todas as ações do módulo</span></label></div>
          <div className="grid gap-4 sm:grid-cols-2">{group.submodules.map(submodule=><fieldset key={submodule.id} className="min-w-0 rounded-md bg-muted/30 p-3"><legend className="px-1 text-sm font-medium">{submodule.label}</legend><div className="grid gap-1">{submodule.options.map(option=>{const id=`${prefix}-${option.key}`;return <label key={option.key} htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm"><Checkbox id={id} checked={permissions.has(option.key)} onCheckedChange={checked=>toggle([option.key],checked===true)}/><span>{option.label}</span></label>;})}</div></fieldset>)}</div>
        </section>;
      })}</div></fieldset>
    </fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button><button className="btn company-primary" disabled={saving}>{saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>} {saving?'Salvando…':profile?'Salvar alterações':'Cadastrar perfil'}</button></div>
  </form>;
}
