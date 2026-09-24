'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import type {Session,User} from '@supabase/supabase-js';
import {useQueryClient} from '@tanstack/react-query';
import {AlertTriangle,Clock3,LogOut,RefreshCw} from 'lucide-react';
import {getSupabaseBrowserClient,getSupabaseConfig} from './client';
import {AuthExperience} from './AuthExperience';
import {Button} from '@/components/ui/button';
import {canApplyAccessCheck,planAuthSessionTransition} from './authLifecycle';

export type WorkspaceAccess='checking'|'ready'|'invite'|'disabled'|'removed'|'invalid'|'error';
export type RefreshAccessOptions={silent?:boolean};
type AuthState={user:User|null;session:Session|null;ready:boolean;error:string;access:WorkspaceAccess;signOut:()=>Promise<void>;refreshAccess:(options?:RefreshAccessOptions)=>Promise<WorkspaceAccess>};
const AuthContext=createContext<AuthState|null>(null);
const IDLE_MS=30*60*1000;
const ACTIVITY_WRITE_MS=15000;

export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error('AuthProvider necessário.');return value;}

export function AuthProvider({children}:{children:ReactNode}){
 const queryClient=useQueryClient();
 const [session,setSession]=useState<Session|null>(null);
 const [access,setAccess]=useState<WorkspaceAccess>('checking');
 const [error]=useState(()=>{try{getSupabaseConfig();return '';}catch(caught){return(caught as Error).message;}});
 const [ready,setReady]=useState(!!error);
 const identity=useRef<string|null>(null);
 const accessCheckRevision=useRef(0);
 const mounted=useRef(true);

 const refreshAccess=useCallback(async({silent=false}:RefreshAccessOptions={}):Promise<WorkspaceAccess>=>{
  const revision=++accessCheckRevision.current;
  const client=getSupabaseBrowserClient();
  const {data:{session:current}}=await client.auth.getSession();
  const checkedUserId=current?.user.id??null;
  const canApply=()=>mounted.current&&canApplyAccessCheck(revision,accessCheckRevision.current,checkedUserId,identity.current);
  if(!current){if(canApply())setAccess('ready');return'ready';}
  if(!silent&&canApply())setAccess('checking');
  const {data,error:rpcError}=await client.rpc('billing_rpc',{p_resource:'onboarding',p_action:'inspect',p_payload:{}});
  const status=rpcError?'error':(['ready','invite','disabled','removed','invalid'].includes(data?.status)?data.status:'error') as WorkspaceAccess;
  if(canApply())setAccess(status);
  return status;
 },[]);

 useEffect(()=>{
  mounted.current=true;let active=true;
  if(error)return()=>{mounted.current=false;};
  const client=getSupabaseBrowserClient();
  const update=(next:Session|null)=>{
   if(!active)return;
   const nextId=next?.user.id??null;
   const transition=planAuthSessionTransition(identity.current,nextId);
   if(transition.clearQueryCache){accessCheckRevision.current++;void queryClient.cancelQueries();queryClient.clear();identity.current=nextId;}
   setSession(next);setReady(true);
   // Supabase emits SIGNED_IN again when a tab is refocused and may also emit
   // TOKEN_REFRESHED. The credentials must be updated, but those same-user
   // events are not a new login and must not unmount the workspace or drafts.
   if(next&&transition.blockForAccessValidation){setAccess('checking');setTimeout(()=>{if(active)void refreshAccess();},0);}
   else if(!next)setAccess('ready');
  };
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,next)=>update(next));
  client.auth.getSession().then(({data,error:sessionError})=>{if(active)update(sessionError?null:data.session);}).catch(()=>{if(active)update(null);});
  return()=>{active=false;mounted.current=false;subscription.unsubscribe();};
 },[queryClient,error,refreshAccess]);

 const signOut=useCallback(async()=>{
  const currentId=identity.current;
  accessCheckRevision.current++;
  const {error:signOutError}=await getSupabaseBrowserClient().auth.signOut({scope:'local'});
  await queryClient.cancelQueries();queryClient.clear();setSession(null);setAccess('ready');identity.current=null;
  if(currentId){try{localStorage.removeItem(`billing:last-activity:${currentId}`);}catch{}}
  if(signOutError)throw signOutError;
 },[queryClient]);

 useEffect(()=>{
  const userId=session?.user.id;if(!userId)return;
  const key=`billing:last-activity:${userId}`;const logoutKey='billing:idle-logout';let lastWrite=0;let ending=false;
  const read=()=>{try{return Number(localStorage.getItem(key))||0;}catch{return 0;}};
  const write=(force=false)=>{const now=Date.now();if(!force&&now-lastWrite<ACTIVITY_WRITE_MS)return;lastWrite=now;try{localStorage.setItem(key,String(now));}catch{}};
  if(!read())write(true);
  const endIdleSession=()=>{if(ending)return;ending=true;try{sessionStorage.setItem('billing:session-notice','idle');}catch{}void signOut().catch(()=>{});};
  const check=()=>{const last=read()||lastWrite;if(!ending&&Date.now()-last>=IDLE_MS){try{localStorage.setItem(logoutKey,JSON.stringify({userId,at:Date.now()}));}catch{}endIdleSession();}};
  const activity=()=>write();
  const visible=()=>{if(document.visibilityState==='visible'){check();if(!ending)write();}};
  const storage=(event:StorageEvent)=>{if(event.key!==logoutKey||!event.newValue)return;try{if((JSON.parse(event.newValue) as {userId?:string}).userId===userId)endIdleSession();}catch{}};
  window.addEventListener('pointerdown',activity,{passive:true});window.addEventListener('pointermove',activity,{passive:true});window.addEventListener('keydown',activity);window.addEventListener('touchstart',activity,{passive:true});window.addEventListener('focus',check);window.addEventListener('storage',storage);document.addEventListener('visibilitychange',visible);
  const timer=window.setInterval(check,15000);check();
  return()=>{window.clearInterval(timer);window.removeEventListener('pointerdown',activity);window.removeEventListener('pointermove',activity);window.removeEventListener('keydown',activity);window.removeEventListener('touchstart',activity);window.removeEventListener('focus',check);window.removeEventListener('storage',storage);document.removeEventListener('visibilitychange',visible);};
 },[session?.user.id,signOut]);

 return <AuthContext.Provider value={{session,user:session?.user??null,ready,error,access,signOut,refreshAccess}}>{children}</AuthContext.Provider>;
}

function AccessBlocked({kind}:{kind:'disabled'|'removed'|'invalid'}){
 const {signOut}=useAuth();const [pending,setPending]=useState(false);
 const content=kind==='disabled'?{title:'Seu acesso está inativo',text:'Um responsável pelo espaço desativou este acesso. Entre em contato com a administração para solicitar a reativação.'}:kind==='removed'?{title:'Acesso excluído',text:'Seu acesso a este espaço foi removido permanentemente. Os registros históricos foram preservados.'}:{title:'Convite indisponível',text:'Este convite foi cancelado, expirou ou já não pode ser utilizado. Solicite um novo convite à administração.'};
 return <main className="auth-screen"><section className="auth-blocked"><span><AlertTriangle/></span><p className="auth-kicker">Controle de Faturamento</p><h1>{content.title}</h1><p>{content.text}</p><Button disabled={pending} onClick={()=>{setPending(true);void signOut().catch(()=>setPending(false));}}><LogOut/>{pending?'Saindo…':'Voltar ao login'}</Button></section></main>;
}

export function AuthGate({children}:{children:ReactNode}){
 const auth=useAuth();const [,rerender]=useState(0);
 useEffect(()=>{const sync=()=>rerender(value=>value+1);window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
 const path=typeof window==='undefined'?'':window.location.pathname;
 const mode=typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('mode');
 if(path.startsWith('/auth/confirm'))return <>{children}</>;
 if(!auth.ready)return <main className="auth-screen"><div className="auth-loading"><Clock3/><span>Carregando sua sessão…</span></div></main>;
 if(auth.user){
  if(mode==='recovery')return <AuthExperience initialMode="recovery"/>;
  if(auth.access==='checking')return <main className="auth-screen"><div className="auth-loading"><Clock3/><span>Validando seu acesso…</span></div></main>;
  if(auth.access==='invite')return <AuthExperience initialMode="invite"/>;
  if(auth.access==='disabled'||auth.access==='removed'||auth.access==='invalid')return <AccessBlocked kind={auth.access}/>;
  if(auth.access==='error')return <main className="auth-screen"><section className="auth-blocked"><span><AlertTriangle/></span><h1>Não foi possível validar o acesso</h1><p>Confira sua conexão e tente novamente.</p><Button onClick={()=>void auth.refreshAccess()}><RefreshCw/>Tentar novamente</Button></section></main>;
  return <>{children}</>;
 }
 return <AuthExperience initialMode={mode==='forgot'?'forgot':'login'} configurationError={auth.error}/>;
}
