import {useState} from 'react';
import {Loader2,Send} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import type {AccessProfile} from '../../perfis-acesso/types';
import type {UserInviteInput} from '../types';

export function UserInviteForm({profiles,onSave,onClose,onBusy}:{profiles:AccessProfile[];onSave:(input:UserInviteInput)=>Promise<unknown>;onClose:()=>void;onBusy:(busy:boolean)=>void}){
  const [profileId,setProfileId]=useState('');const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  return <form onSubmit={async event=>{event.preventDefault();if(saving)return;const data=new FormData(event.currentTarget);setError('');setSaving(true);onBusy(true);try{if(!profileId)throw new Error('Selecione um perfil de acesso.');await onSave({email:String(data.get('email')??''),accessProfileId:profileId});notifications.created('O convite foi enviado por e-mail. A pessoa definirá o nome e a senha ao aceitar.');onClose();}catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}finally{setSaving(false);onBusy(false);}}}>
    <fieldset disabled={saving} className="company-fieldset"><Field label="E-mail"><input name="email" type="email" autoComplete="email" maxLength={254} required autoFocus placeholder="usuario@empresa.com"/></Field><Field label="Perfil de acesso"><Select value={profileId} onValueChange={setProfileId} required><SelectTrigger className="choice"><SelectValue placeholder="Selecione um perfil"/></SelectTrigger><SelectContent>{profiles.map(profile=><SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent></Select></Field><p className="field-help">A pessoa receberá um link de uso único. O e-mail será o usuário de acesso; ao abrir o convite, ela definirá o nome e a senha.</p></fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button><button className="btn company-primary" disabled={saving||!profiles.length}>{saving?<Loader2 className="animate-spin" size={16}/>:<Send size={16}/>} {saving?'Enviando…':'Enviar convite'}</button></div>
  </form>;
}
