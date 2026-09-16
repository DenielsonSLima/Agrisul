import {useState} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import type {AccessProfile} from '../../perfis-acesso/types';
import type {BillingUser} from '../types';

export function UserAccessForm({member,profiles,onSave,onClose,onBusy}:{member:BillingUser;profiles:AccessProfile[];onSave:(profileId:string)=>Promise<unknown>;onClose:()=>void;onBusy:(busy:boolean)=>void}){
  const [profileId,setProfileId]=useState(member.accessProfileId??'');const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  return <form onSubmit={async event=>{event.preventDefault();if(saving)return;setError('');setSaving(true);onBusy(true);try{if(!profileId)throw new Error('Selecione um perfil de acesso.');await onSave(profileId);notifications.updated(`O acesso de ${member.name||member.email} foi atualizado.`);onClose();}catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}finally{setSaving(false);onBusy(false);}}}>
    <fieldset disabled={saving} className="company-fieldset"><p className="field-help">{member.email}</p><Field label="Perfil de acesso"><Select value={profileId} onValueChange={setProfileId} required><SelectTrigger className="choice" autoFocus><SelectValue placeholder="Selecione um perfil"/></SelectTrigger><SelectContent>{profiles.map(profile=><SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent></Select></Field></fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button><button className="btn company-primary" disabled={saving||!profileId}>{saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>} {saving?'Salvando…':'Salvar acesso'}</button></div>
  </form>;
}
