'use client';
import {useState} from 'react';
import {LogOut} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useAuth} from './AuthProvider';
export function SessionButton(){
  const {signOut}=useAuth();const [pending,setPending]=useState(false);const [error,setError]=useState('');
  async function logout(){setPending(true);setError('');try{await signOut();}catch{setError('Não foi possível sair. Tente novamente.');setPending(false);}}
  return <><Button variant="ghost" size="sm" onClick={logout} disabled={pending} aria-label="Sair da conta"><LogOut size={16}/><span>{pending?'Saindo...':'Sair'}</span></Button>{error&&<span role="alert">{error}</span>}</>;
}
