import Link from 'next/link';
import {Loader2,RefreshCw,Users} from 'lucide-react';
export function ClientLoadState({loading,status,error,onRetry}:{loading:boolean;status:number;error:string;onRetry:()=>void}){
 if(loading)return <div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando clientes…</div>;
 if(status===401)return <div className="company-empty"><span className="company-empty-icon"><Users size={25}/></span><h3>Acesse seus clientes</h3><p>Entre para consultar e cadastrar os parceiros da sua conta.</p><Link className="btn company-primary" href="/login?returnTo=%2Fcadastro%3Fsecao%3Dclientes" target="_top">Entrar</Link></div>;
 return <div className="company-empty" role="alert"><h3>{status===404?'Cliente não encontrado':'Não foi possível carregar'}</h3><p>{error}</p>{status!==404&&<button className="btn" onClick={onRetry}><RefreshCw size={16}/>Tentar novamente</button>}</div>;
}
