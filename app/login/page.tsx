'use client';
import {useEffect} from 'react';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {safeLoginReturnTo} from '@/shared/supabase/oauthConsent';
export default function LoginPage(){
  const {user}=useAuth();
  useEffect(()=>{
    if(!user)return;
    const target=new URLSearchParams(window.location.search).get('returnTo')||'/';
    const safe=safeLoginReturnTo(target,window.location.origin);
    window.location.replace(safe);
  },[user]);
  return <p role="status">Abrindo seu espaço...</p>;
}
