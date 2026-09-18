'use client';

import {useEffect,useState} from 'react';
import type {EmailOtpType} from '@supabase/supabase-js';
import {CheckCircle2,Loader2,MailCheck,ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';

type Confirmation={tokenHash:string;type:EmailOtpType}|null;
const allowedTypes=new Set<EmailOtpType>(['invite','recovery','signup','email','magiclink']);

export default function AuthConfirmPage(){
  const [confirmation,setConfirmation]=useState<Confirmation>(null);
  const [invalid,setInvalid]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;const cleanup=()=>{active=false;};const later=(action:()=>void)=>queueMicrotask(()=>{if(active)action();});
    const url=new URL(window.location.href);const tokenHash=url.searchParams.get('token_hash')??'';const rawType=url.searchParams.get('type') as EmailOtpType|null;
    const hash=new URLSearchParams(url.hash.slice(1));const callbackType=(hash.get('type')??rawType) as EmailOtpType|null;
    if(!tokenHash&&(url.searchParams.has('code')||hash.has('access_token'))){
      later(()=>setBusy(true));
      void getSupabaseBrowserClient().auth.getSession().then(({data,error:sessionError})=>{
        if(!active)return;
        if(sessionError||!data.session)throw sessionError??new Error('Sessão ausente');
        window.history.replaceState({},'',url.pathname);
        const mode=callbackType==='invite'?'invite':callbackType==='recovery'?'recovery':'';
        window.location.replace(mode?`/login?mode=${mode}`:'/');
      }).catch(()=>{if(active){setError('Este link é inválido, expirou ou já foi utilizado. Solicite um novo envio.');setBusy(false);}});
      return cleanup;
    }
    if(!tokenHash||!rawType||!allowedTypes.has(rawType)){later(()=>setInvalid(true));return cleanup;}
    later(()=>setConfirmation({tokenHash,type:rawType}));
    window.history.replaceState({},'',url.pathname);
    return cleanup;
  },[]);

  const confirm=async()=>{
    if(!confirmation)return;setBusy(true);setError('');
    try{
      const {error:verifyError}=await getSupabaseBrowserClient().auth.verifyOtp({token_hash:confirmation.tokenHash,type:confirmation.type});if(verifyError)throw verifyError;
      const mode=confirmation.type==='invite'?'invite':confirmation.type==='recovery'?'recovery':'';
      window.location.replace(mode?`/login?mode=${mode}`:'/');
    }catch{setError('Este link é inválido, expirou ou já foi utilizado. Solicite um novo envio.');setBusy(false);}
  };

  return <main className="auth-screen auth-confirm-screen"><section className="auth-confirm-card">
    <span className="auth-confirm-icon">{invalid?<ShieldCheck/>:error?<ShieldCheck/>:<MailCheck/>}</span>
    <p className="auth-kicker">Controle de Faturamento</p>
    <h1>{invalid||error?'Não foi possível confirmar':busy&&!confirmation?'Validando seu link…':'Confirme para continuar'}</h1>
    <p>{invalid||error?error||'O endereço acessado não contém uma confirmação válida.':busy&&!confirmation?'Aguarde enquanto preparamos seu acesso.':'Por segurança, confirme abaixo que deseja usar este link para acessar sua conta.'}</p>
    {!invalid&&!error&&<Button size="lg" disabled={busy||!confirmation} onClick={()=>void confirm()}>{busy?<Loader2 className="animate-spin"/>:<CheckCircle2/>}{busy?'Validando…':'Confirmar e continuar'}</Button>}
    {(invalid||error)&&<Button variant="outline" size="lg" onClick={()=>window.location.replace('/login')}>Voltar ao login</Button>}
  </section></main>;
}
