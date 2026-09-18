'use client';
import {useState} from 'react';
import {LogOut} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useConfirmation} from '@/shared/feedback';
import {useAuth} from './AuthProvider';
export function SessionButton(){
  const {signOut}=useAuth();const confirm=useConfirmation();const [pending,setPending]=useState(false);const [error,setError]=useState('');
  async function logout(){
    const confirmed=await confirm({
      title:'Deseja realmente sair?',
      description:'Sua sessão será encerrada e você precisará entrar novamente para acessar o sistema.',
      confirmLabel:'Sair',
      tone:'destructive',
    });
    if(!confirmed)return;
    setPending(true);setError('');try{await signOut();}catch{setError('Não foi possível sair. Tente novamente.');setPending(false);}
  }
  return <><Button variant="ghost" size="sm" onClick={logout} disabled={pending} aria-label="Sair da conta"><LogOut size={16}/><span>{pending?'Saindo...':'Sair'}</span></Button>{error&&<span role="alert">{error}</span>}</>;
}
