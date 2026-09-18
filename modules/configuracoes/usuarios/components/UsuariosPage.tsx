import {useMemo,useState} from 'react';
import {Loader2,MailPlus,Pencil,Power,PowerOff,RefreshCw,ShieldCheck,Trash2,Users,X} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {LocalSearch} from '@/shared/components/Common';
import {normalize} from '@/shared/utils/format';
import {notifications,useConfirmation} from '@/shared/feedback';
import {useAccessProfiles} from '../../perfis-acesso/hooks/useAccessProfiles';
import {useUsers} from '../hooks/useUsers';
import {UserInviteForm} from '../forms/UserInviteForm';
import {UserAccessForm} from '../forms/UserAccessForm';
import type {BillingUser,BillingUserStatus} from '../types';

const statusLabel:Record<BillingUserStatus,string>={pending:'Pendente',active:'Ativo',inactive:'Inativo'};

export function UsuariosPage(){
  const users=useUsers();const profiles=useAccessProfiles();const confirm=useConfirmation();
  const [query,setQuery]=useState('');const [dialog,setDialog]=useState<'invite'|'access'|null>(null);const [selected,setSelected]=useState<BillingUser>();const [dialogBusy,setDialogBusy]=useState(false);const [actionId,setActionId]=useState('');const [actionError,setActionError]=useState('');
  const filtered=useMemo(()=>users.users.filter(member=>normalize(`${member.name} ${member.email} ${member.accessProfileName}`).includes(normalize(query))),[users.users,query]);
  const close=()=>{setDialog(null);setSelected(undefined);};
  const changeStatus=async(member:BillingUser)=>{
    if(member.isOwner)return;const enabling=member.status==='inactive';const pending=member.status==='pending';
    if(!enabling){const accepted=await confirm({title:pending?`Cancelar convite de ${member.email}?`:`Inativar ${member.name||member.email}?`,description:pending?'O link enviado deixará de conceder acesso a este espaço. Um novo convite poderá ser enviado depois.':'O usuário perderá imediatamente o acesso aos dados deste espaço de trabalho. O cadastro poderá ser reativado depois.',confirmLabel:pending?'Cancelar convite':'Inativar usuário',tone:'destructive'});if(!accepted)return;}
    setActionId(member.id);setActionError('');
    try{if(pending)await users.cancelInvite(member.id);else await users.setEnabled(member.id,enabling);notifications.updated(enabling?'O usuário foi reativado.':pending?'O convite foi cancelado.':'O usuário foi inativado.');}
    catch(caught){const message=(caught as Error).message;setActionError(message);notifications.error(message);}
    finally{setActionId('');}
  };
  const remove=async(member:BillingUser)=>{
    if(member.isOwner||member.status==='pending')return;
    const accepted=await confirm({title:`Excluir o acesso de ${member.name||member.email}?`,description:'Esta remoção é permanente: a pessoa perderá o acesso ao espaço e não poderá ser reativada. O histórico operacional será preservado.',confirmLabel:'Excluir acesso',tone:'destructive'});if(!accepted)return;
    setActionId(member.id);setActionError('');
    try{await users.remove(member.id);notifications.deleted('O acesso do usuário foi excluído permanentemente.');}
    catch(caught){const message=(caught as Error).message;setActionError(message);notifications.error(message);}
    finally{setActionId('');}
  };
  const loading=users.loading||profiles.loading;const error=users.error||profiles.error;
  return <section className="companies-section">
    <div className="companies-heading"><div><h2>Usuários</h2><p>Convide pessoas e controle o acesso ao espaço de trabalho.</p></div>{!users.authRequired&&<button className="btn company-primary" disabled={loading||!!error||!profiles.profiles.length} onClick={()=>{setSelected(undefined);setDialog('invite');}}><MailPlus size={17}/>Convidar usuário</button>}</div>
    {actionError&&<p className="form-error" role="alert">{actionError}</p>}
    {loading?<div className="client-loading" role="status"><Loader2 className="animate-spin" size={20}/>Carregando usuários…</div>:users.authRequired?<div className="company-empty"><span className="company-empty-icon"><Users size={26}/></span><h3>Entre para gerenciar usuários</h3><p>Somente pessoas autorizadas podem acessar esta configuração.</p></div>:error?<div className="company-empty" role="alert"><h3>Não foi possível carregar</h3><p>{error}</p><button className="btn" onClick={()=>{void users.reload();void profiles.reload();}}><RefreshCw size={16}/>Tentar novamente</button></div>:<div className="panel">
      <div className="table-toolbar"><LocalSearch value={query} onChange={setQuery} placeholder="Buscar por nome, e-mail ou perfil…"/><span className="farm-count">{users.users.length} usuário{users.users.length!==1?'s':''}</span></div>
      {!filtered.length?<div className="empty">{users.users.length?'Nenhum usuário encontrado.':'Nenhum usuário cadastrado.'}</div>:<Table><caption className="sr-only">Usuários do espaço de trabalho</caption><TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead>Perfil</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Ações</span></TableHead></TableRow></TableHeader><TableBody>{filtered.map(member=>{const actionLabel=member.status==='inactive'?'Reativar':member.status==='pending'?'Cancelar convite':'Inativar';return <TableRow key={member.id}><TableCell><div className="person"><span className="avatar" aria-hidden="true">{(member.name||member.email).slice(0,2).toUpperCase()}</span><div><strong>{member.name||'Convite pendente'}{member.isOwner?' · Proprietário':''}</strong><small>{member.email}</small></div></div></TableCell><TableCell><span className="inline-actions"><ShieldCheck size={15}/>{member.isOwner?'Proprietário':member.accessProfileName||'Sem perfil'}</span></TableCell><TableCell><span className={`status status-${statusLabel[member.status].toLowerCase()}`}>{statusLabel[member.status]}</span></TableCell><TableCell><div className="inline-actions">{!member.isOwner&&<><button type="button" className="icon-btn" aria-label={`Editar acesso de ${member.name||member.email}`} title="Editar acesso" disabled={!!actionId} onClick={()=>{setSelected(member);setDialog('access');}}><Pencil size={15}/></button><button type="button" className="icon-btn" aria-label={`${actionLabel} ${member.name||member.email}`} title={actionLabel} disabled={!!actionId} onClick={()=>{void changeStatus(member);}}>{actionId===member.id?<Loader2 className="animate-spin" size={15}/>:member.status==='inactive'?<Power size={15}/>:member.status==='pending'?<X size={15}/>:<PowerOff size={15}/>}</button>{member.status!=='pending'&&<button type="button" className="icon-btn user-delete" aria-label={`Excluir acesso de ${member.name||member.email}`} title="Excluir acesso" disabled={!!actionId} onClick={()=>{void remove(member);}}><Trash2 size={15}/></button>}</>}</div></TableCell></TableRow>;})}</TableBody></Table>}
    </div>}
    <Dialog open={dialog==='invite'} onOpenChange={open=>{if(!open&&!dialogBusy)close();}}><DialogContent className="form-modal farm-modal" onEscapeKeyDown={event=>{if(dialogBusy)event.preventDefault();}} onPointerDownOutside={event=>{if(dialogBusy)event.preventDefault();}}><DialogHeader><DialogTitle>Convidar usuário</DialogTitle><DialogDescription>Envie um convite por e-mail e defina o perfil inicial de acesso.</DialogDescription></DialogHeader><UserInviteForm profiles={profiles.profiles} onBusy={setDialogBusy} onClose={close} onSave={users.invite}/></DialogContent></Dialog>
    <Dialog open={dialog==='access'&&!!selected} onOpenChange={open=>{if(!open&&!dialogBusy)close();}}><DialogContent className="form-modal farm-modal" onEscapeKeyDown={event=>{if(dialogBusy)event.preventDefault();}} onPointerDownOutside={event=>{if(dialogBusy)event.preventDefault();}}><DialogHeader><DialogTitle>Editar acesso</DialogTitle><DialogDescription>Escolha as permissões aplicadas a este usuário.</DialogDescription></DialogHeader>{selected&&<UserAccessForm key={selected.id} member={selected} profiles={profiles.profiles} onBusy={setDialogBusy} onClose={close} onSave={profileId=>users.updateAccess(selected.id,profileId)}/>}</DialogContent></Dialog>
  </section>;
}
