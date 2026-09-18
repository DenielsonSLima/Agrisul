'use client';

import {useEffect,useId,useMemo,useState,type FormEvent,type ReactNode} from 'react';
import {ArrowLeft,BarChart3,CheckCircle2,Eye,EyeOff,FileText,Leaf,Loader2,LockKeyhole,Mail,ReceiptText,ShieldCheck,UserRound} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {getSupabaseBrowserClient} from './client';
import {RpcError,rpcRequest} from './rpc';
import {useAuth} from './AuthProvider';

type AuthMode='login'|'signup'|'forgot'|'recovery'|'invite';
type Message={tone:'error'|'success';text:string}|null;

const modeCopy:Record<AuthMode,{kicker:string;title:string;text:string;submit:string}>={
  login:{kicker:'Bem-vindo de volta',title:'Acesse seu espaço',text:'Entre para acompanhar contratos, faturamento e operação em um só lugar.',submit:'Entrar no sistema'},
  signup:{kicker:'Comece agora',title:'Crie seu espaço',text:'Cadastre a conta proprietária para organizar toda a sua operação.',submit:'Criar minha conta'},
  forgot:{kicker:'Recuperar acesso',title:'Esqueceu a senha?',text:'Informe seu e-mail. Se ele estiver cadastrado, enviaremos um link seguro.',submit:'Enviar link de recuperação'},
  recovery:{kicker:'Nova senha',title:'Proteja sua conta',text:'Crie uma nova senha para voltar ao sistema com segurança.',submit:'Atualizar senha'},
  invite:{kicker:'Convite aceito',title:'Conclua seu cadastro',text:'Defina como seu nome aparecerá e crie uma senha pessoal para acessar o espaço.',submit:'Concluir e acessar'},
};

function authErrorMessage(caught:unknown){
  if(caught instanceof RpcError)return caught.message;
  const message=(caught as {message?:string})?.message?.toLowerCase()??'';
  if(message.includes('invalid login credentials'))return'E-mail ou senha incorretos.';
  if(message.includes('email not confirmed'))return'Confirme seu e-mail antes de entrar.';
  if(message.includes('user already registered'))return'Este e-mail já possui uma conta.';
  if(message.includes('password'))return'A senha não atende aos requisitos de segurança.';
  if(message.includes('rate limit'))return'Muitas tentativas seguidas. Aguarde um instante e tente novamente.';
  return'Não foi possível concluir. Confira os dados e tente novamente.';
}

function PasswordField({label,value,onChange,autoComplete='current-password',action}:{label:string;value:string;onChange:(value:string)=>void;autoComplete?:string;action?:ReactNode}){
  const [visible,setVisible]=useState(false);const id=useId();
  return <div className="auth-field"><span className="auth-field-title"><label htmlFor={id}>{label}</label>{action}</span><span className="auth-input-wrap"><LockKeyhole aria-hidden="true"/><Input id={id} required minLength={8} type={visible?'text':'password'} value={value} onChange={event=>onChange(event.target.value)} autoComplete={autoComplete}/><button type="button" onClick={()=>setVisible(value=>!value)} aria-label={visible?'Ocultar senha':'Mostrar senha'}>{visible?<EyeOff/>:<Eye/>}</button></span></div>;
}

function AuthShell({children}:{children:ReactNode}){
  return <main className="auth-screen">
    <section className="auth-story" aria-label="Visão geral do sistema">
      <div className="auth-orbit auth-orbit-one"/><div className="auth-orbit auth-orbit-two"/>
      <div className="auth-story-content">
        <div className="auth-brand"><span><Leaf/></span><strong>Controle de Faturamento</strong></div>
        <div className="auth-story-copy"><p>Gestão que acompanha o ritmo do campo</p><h2>Da operação ao faturamento, tudo sob controle.</h2><span>Centralize contratos, acompanhe resultados e tome decisões com dados claros e seguros.</span></div>
        <div className="auth-feature-grid">
          <article><span><ReceiptText/></span><div><strong>Faturamento integrado</strong><small>Visão precisa de valores e saldos.</small></div></article>
          <article><span><BarChart3/></span><div><strong>Decisões mais claras</strong><small>Indicadores prontos para acompanhar.</small></div></article>
          <article><span><FileText/></span><div><strong>Contratos organizados</strong><small>Informação operacional em um só lugar.</small></div></article>
        </div>
        <div className="auth-security"><ShieldCheck/><span><strong>Ambiente protegido</strong><small>Sessões expiram após 30 minutos sem atividade.</small></span></div>
      </div>
    </section>
    <section className="auth-form-side"><div className="auth-mobile-brand"><Leaf/><span>Controle de Faturamento</span></div>{children}</section>
  </main>;
}

export function AuthExperience({initialMode='login',configurationError=''}:{initialMode?:AuthMode;configurationError?:string}){
  const {user,refreshAccess}=useAuth();
  const [mode,setMode]=useState<AuthMode>(initialMode);
  const [email,setEmail]=useState(user?.email??'');
  const [name,setName]=useState((user?.user_metadata?.display_name as string|undefined)??'');
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<Message>(configurationError?{tone:'error',text:configurationError}:null);
  const copy=modeCopy[mode];
  const needsPassword=mode==='login'||mode==='signup'||mode==='recovery'||mode==='invite';
  const needsConfirmation=mode==='signup'||mode==='recovery'||mode==='invite';
  const returnTo=useMemo(()=>{
    if(typeof window==='undefined')return'/';
    const candidate=new URLSearchParams(window.location.search).get('returnTo');
    if(!candidate)return'/';
    try{const parsed=new URL(candidate,window.location.origin);return parsed.origin===window.location.origin&&!parsed.pathname.startsWith('/login')?parsed.pathname+parsed.search+parsed.hash:'/';}catch{return'/';}
  },[]);

  useEffect(()=>{
    let active=true;
    if(initialMode==='login'){
      let notice='';try{notice=sessionStorage.getItem('billing:session-notice')??'';sessionStorage.removeItem('billing:session-notice');}catch{}
      queueMicrotask(()=>{
        if(!active)return;
        if(notice==='idle')setMessage({tone:'success',text:'Sua sessão foi encerrada após 30 minutos sem atividade.'});
        if(notice==='password')setMessage({tone:'success',text:'Senha atualizada. Você já pode continuar.'});
      });
    }
    return()=>{active=false;};
  },[initialMode]);

  const changeMode=(next:AuthMode)=>{setMode(next);setMessage(null);setPassword('');setConfirmation('');};
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setMessage(null);
    if(needsConfirmation&&password!==confirmation){setMessage({tone:'error',text:'As senhas digitadas não são iguais.'});return;}
    if(needsPassword&&password.length<8){setMessage({tone:'error',text:'Use uma senha com pelo menos 8 caracteres.'});return;}
    setBusy(true);
    try{
      const client=getSupabaseBrowserClient();
      if(mode==='login'){
        const {error}=await client.auth.signInWithPassword({email:email.trim().toLowerCase(),password});if(error)throw error;
        window.location.replace(returnTo);return;
      }
      if(mode==='signup'){
        const {error}=await client.auth.signUp({email:email.trim().toLowerCase(),password,options:{data:{display_name:name.trim()},emailRedirectTo:`${window.location.origin}/auth/confirm`}});if(error)throw error;
        setMessage({tone:'success',text:'Cadastro recebido. Abra o link enviado ao seu e-mail para confirmar a conta.'});return;
      }
      if(mode==='forgot'){
        const {error}=await client.auth.resetPasswordForEmail(email.trim().toLowerCase(),{redirectTo:`${window.location.origin}/auth/confirm`});if(error)throw error;
        setMessage({tone:'success',text:'Se este e-mail estiver cadastrado, o link de recuperação chegará em instantes.'});return;
      }
      if(mode==='recovery'){
        const {error}=await client.auth.updateUser({password});if(error)throw error;
        try{sessionStorage.setItem('billing:session-notice','password');}catch{}
        window.location.replace('/');return;
      }
      const cleanName=name.trim();if(cleanName.length<2)throw new RpcError('Informe seu nome com pelo menos 2 caracteres.');
      const {error:updateError}=await client.auth.updateUser({password,data:{display_name:cleanName,onboarding_required:false}});if(updateError)throw updateError;
      await rpcRequest('onboarding','complete',{name:cleanName});await refreshAccess();window.location.replace('/');
    }catch(caught){setMessage({tone:'error',text:authErrorMessage(caught)});}
    finally{setBusy(false);}
  };

  return <AuthShell><section className="auth-panel">
    {(mode==='forgot'||mode==='signup')&&<button type="button" className="auth-back" onClick={()=>changeMode('login')}><ArrowLeft/>Voltar ao login</button>}
    <p className="auth-kicker">{copy.kicker}</p><h1>{copy.title}</h1><p className="auth-description">{copy.text}</p>
    {mode==='invite'&&<div className="auth-invite-note"><CheckCircle2/><span>Seu e-mail já foi validado pelo convite.</span></div>}
    <form onSubmit={submit}>
      {(mode==='signup'||mode==='invite')&&<label className="auth-field"><span>Nome completo</span><span className="auth-input-wrap"><UserRound aria-hidden="true"/><Input required minLength={2} value={name} onChange={event=>setName(event.target.value)} autoComplete="name" placeholder="Como devemos chamar você?"/></span></label>}
      {(mode==='login'||mode==='signup'||mode==='forgot'||mode==='invite')&&<label className="auth-field"><span>{mode==='invite'?'Usuário de acesso':'E-mail'}</span><span className="auth-input-wrap"><Mail aria-hidden="true"/><Input required type="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="email" readOnly={mode==='invite'} placeholder="voce@empresa.com.br"/></span></label>}
      {needsPassword&&<PasswordField label={mode==='login'?'Senha':'Crie uma senha'} value={password} onChange={setPassword} autoComplete={mode==='login'?'current-password':'new-password'} action={mode==='login'?<button type="button" className="auth-forgot" onClick={()=>changeMode('forgot')}>Esqueci minha senha</button>:undefined}/>} 
      {needsConfirmation&&<PasswordField label="Confirme a senha" value={confirmation} onChange={setConfirmation} autoComplete="new-password"/>}
      {message&&<p className={`auth-message auth-message-${message.tone}`} role={message.tone==='error'?'alert':'status'}>{message.tone==='success'?<CheckCircle2/>:null}{message.text}</p>}
      <Button type="submit" className="auth-submit" size="lg" disabled={busy||!!configurationError}>{busy?<Loader2 className="animate-spin"/>:<LockKeyhole/>}{busy?'Aguarde…':copy.submit}</Button>
    </form>
    {mode==='login'&&<><div className="auth-divider"><span>ou</span></div><button type="button" className="auth-secondary" onClick={()=>changeMode('signup')}>Criar um novo espaço</button></>}
    {mode==='signup'&&<p className="auth-terms">Ao continuar, você confirma que está autorizado a criar este espaço de trabalho.</p>}
  </section></AuthShell>;
}
