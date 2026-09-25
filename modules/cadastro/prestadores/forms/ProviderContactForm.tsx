'use client';
import {useEffect,useRef,useState} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import {notifications,useConfirmation} from '@/shared/feedback';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useProviderContactMutations} from '../hooks/useProviders';
import type {ProviderContact,ProviderContactInput} from '../types';

export function ProviderContactForm({providerId,contact,onClose}:{providerId:string;contact?:ProviderContact;onClose:()=>void}){
 const initial:ProviderContactInput={providerId,name:contact?.name??'',phone:contact?.phone??''};
 const [data,setData]=useState(initial),[error,setError]=useState('');
 const mutations=useProviderContactMutations(),confirm=useConfirmation(),busy=mutations.saving,{user}=useAuth(),operation=useRef<AbortController|null>(null);
 useEffect(()=>()=>operation.current?.abort(),[]);
 const close=async()=>{if(busy)return;if(JSON.stringify(data)!==JSON.stringify(initial)&&!await confirm({title:'Descartar alterações do contato?',description:'O nome e o telefone preenchidos ainda não foram salvos.',confirmLabel:'Descartar alterações',tone:'destructive'}))return;onClose();};
 return <Dialog open onOpenChange={open=>{if(!open)void close();}}><DialogContent className="form-modal provider-contact-modal" showCloseButton={!busy} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}><DialogHeader><DialogTitle>{contact?'Editar contato':'Novo contato'}</DialogTitle><DialogDescription>Cadastre a pessoa responsável e o telefone que poderão sair no pedido de compra.</DialogDescription></DialogHeader><form className="provider-contact-form" aria-busy={busy} onSubmit={async event=>{event.preventDefault();if(busy)return;setError('');const controller=new AbortController();operation.current=controller;try{await mutations.save({input:data,id:contact?.id,execution:{actorId:user?.id??'',signal:controller.signal}});if(contact)notifications.updated('O contato do prestador foi atualizado.');else notifications.created('O contato do prestador foi cadastrado.');onClose();}catch(reason){if(!controller.signal.aborted){const message=(reason as Error).message||'Não foi possível salvar o contato.';setError(message);notifications.error(message);}}}}><fieldset disabled={busy}><Field label="Nome do responsável *"><input autoFocus name="name" required maxLength={120} value={data.name} onChange={event=>setData(current=>({...current,name:event.target.value}))} placeholder="Ex.: José Carlos"/></Field><Field label="Telefone / contato *"><input name="phone" type="tel" required maxLength={40} value={data.phone} onChange={event=>setData(current=>({...current,phone:event.target.value}))} placeholder="Ex.: (79) 99999-9999"/></Field></fieldset>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="btn" type="button" disabled={busy} onClick={()=>void close()}>Cancelar</button><button className="btn company-primary" type="submit" disabled={busy}>{busy?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {busy?'Salvando…':'Salvar contato'}</button></div></form></DialogContent></Dialog>;
}
