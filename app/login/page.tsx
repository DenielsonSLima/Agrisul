'use client';
import {useEffect} from 'react';
import {useAuth} from '@/shared/supabase/AuthProvider';
export default function LoginPage(){
  const {user}=useAuth();
  useEffect(()=>{
    if(!user)return;
    const target=new URLSearchParams(window.location.search).get('returnTo')||'/';
    let safe='/';
    try{const parsed=new URL(target,window.location.origin);if(parsed.origin===window.location.origin&&!parsed.pathname.startsWith('/login'))safe=parsed.pathname+parsed.search+parsed.hash;}catch{}
    window.location.replace(safe);
  },[user]);
  return <p role="status">Abrindo seu espaço...</p>;
}
