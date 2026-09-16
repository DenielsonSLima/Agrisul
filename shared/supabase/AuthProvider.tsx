'use client';
import {Fragment, createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react';
import type {Session, User} from '@supabase/supabase-js';
import {useQueryClient} from '@tanstack/react-query';
import {ReceiptText} from 'lucide-react';
import {getSupabaseBrowserClient,getSupabaseConfig} from './client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

type AuthState = {user: User|null; session: Session|null; ready: boolean; error: string; signOut: () => Promise<void>};
const AuthContext = createContext<AuthState|null>(null);
export function useAuth() {const value=useContext(AuthContext);if(!value)throw new Error('AuthProvider necessário.');return value;}
export function AuthProvider({children}: {children: ReactNode}) {
  const queryClient=useQueryClient();
  const [session,setSession]=useState<Session|null>(null);
  const [error]=useState(()=>{try{getSupabaseConfig();return '';}catch(e){return (e as Error).message;}});
  const [ready,setReady]=useState(!!error);
  const identity=useRef<string|null>(null);
  useEffect(()=>{
    let active=true;
    if(error)return;
    const client=getSupabaseBrowserClient();
    const update=(next:Session|null)=>{
      if(!active)return;
      if(identity.current!== (next?.user.id??null)) {
        void queryClient.cancelQueries();
        queryClient.clear();
        identity.current=next?.user.id??null;
      }
      setSession(next);setReady(true);
    };
    const {data:{subscription}}=client.auth.onAuthStateChange((_event,next)=>update(next));
    client.auth.getSession().then(({data,error})=>{
      if(!active)return;
      if(error){update(null);return;}
      update(data.session);
    }).catch(()=>{if(active)update(null);});
    return()=>{active=false;subscription.unsubscribe();};
  },[queryClient,error]);
  async function signOut(){
    const {error}=await getSupabaseBrowserClient().auth.signOut();
    if(error)throw error;
    await queryClient.cancelQueries();queryClient.clear();
    setSession(null);identity.current=null;
  }
  return <AuthContext.Provider value={{session,user:session?.user??null,ready,error,signOut}}>{children}</AuthContext.Provider>;
}
function authMessage(message:string) {
  if(/invalid login credentials/i.test(message))return 'E-mail ou senha incorretos.';
  if(/email not confirmed/i.test(message))return 'Confirme seu e-mail antes de entrar.';
  if(/already registered/i.test(message))return 'Este e-mail já está cadastrado. Use Entrar.';
  if(/rate limit/i.test(message))return 'Aguarde alguns minutos antes de tentar novamente.';
  return 'Não foi possível concluir. Confira os dados e tente novamente.';
}
export function AuthGate({children}:{children:ReactNode}) {
  const {user,ready,error:configurationError}=useAuth();
  const [mode,setMode]=useState<'login'|'signup'>('login');
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [name,setName]=useState('');const [pending,setPending]=useState(false);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');
  async function submit(event:FormEvent){
    event.preventDefault();setPending(true);setError('');setNotice('');
    try{
      const auth=getSupabaseBrowserClient().auth;
      const result=mode==='login'
        ? await auth.signInWithPassword({email:email.trim(),password})
        : await auth.signUp({email:email.trim(),password,options:{data:{display_name:name.trim()},emailRedirectTo:window.location.origin+'/login'}});
      if(result.error){setError(authMessage(result.error.message));return;}
      if(mode==='signup'&&!result.data.session)setNotice('Conta criada. Confira seu e-mail para confirmar o cadastro e entrar.');
      setPassword('');
    }catch{setError('Não foi possível conectar. Verifique sua internet e tente novamente.');}
    finally{setPending(false);}
  }
  if(!ready)return <div className="auth-screen" role="status">Carregando sua sessão...</div>;
  if(user)return <Fragment key={user.id}>{children}</Fragment>;
  return <main className="auth-screen"><section className="auth-panel">
    <div className="auth-brand"><ReceiptText size={28}/><strong>Controle de Faturamento</strong></div>
    <h1>{mode==='login'?'Entre no seu espaço':'Crie sua conta'}</h1>
    <p>Acesse seus cadastros e configurações com sua conta.</p>
    <form onSubmit={submit}>
      {mode==='signup'&&<div className="auth-field"><Label htmlFor="auth-name">Nome</Label><Input id="auth-name" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} required/></div>}
      <div className="auth-field"><Label htmlFor="auth-email">E-mail</Label><Input id="auth-email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></div>
      <div className="auth-field"><Label htmlFor="auth-password">Senha</Label><Input id="auth-password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={mode==='signup'?8:undefined} required/></div>
      {(error||configurationError)&&<p role="alert" className="auth-error">{error||configurationError}</p>}
      {notice&&<p role="status">{notice}</p>}
      <Button type="submit" disabled={pending||!!configurationError} className="auth-submit">{pending?'Aguarde...':mode==='login'?'Entrar':'Criar conta'}</Button>
      <Button type="button" variant="ghost" disabled={pending} onClick={()=>{setMode(mode==='login'?'signup':'login');setError('');setNotice('');}}>{mode==='login'?'Criar uma conta':'Já tenho uma conta'}</Button>
    </form>
  </section></main>;
}
