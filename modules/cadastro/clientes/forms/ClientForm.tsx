import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {Building2,MapPin,Phone,Search,Loader2,Check,Save} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {ModuleLink,useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {notifications} from '@/shared/feedback';
import {normalizeCnpj} from '@/shared/utils/cnpj';
import {clientLimits} from '../utils/clientFields';
import {clientsHref,clientHref} from '../utils/clientFormat';
import {ClientApiError,fetchClientCnpj} from '../services/clientApi';
import {useClientsMutation} from '../hooks/useClients';
import {emptyClient,type Client,type ClientInput} from '../types';
export function ClientForm({client}:{client?:Client}){
  const mutation=useClientsMutation();
  const [data,setData]=useState<ClientInput>(client||{...emptyClient});const [looking,setLooking]=useState(false);const [saving,setSaving]=useState(false);const [error,setError]=useState('');const [lookupError,setLookupError]=useState('');const [success,setSuccess]=useState(false);const [auth,setAuth]=useState(false);
  const mounted=useRef(true);const request=useRef<AbortController|null>(null);const {navigate}=useModuleNavigation();
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
  const change=(key:keyof ClientInput,value:string)=>setData(current=>({...current,[key]:value}));
  const field=(key:keyof ClientInput,label:string,required=false,type='text')=><Field label={label}><input name={key} value={data[key]} type={type} maxLength={clientLimits[key]} required={required} onChange={e=>change(key,e.target.value)}/></Field>;
  const consult=async()=>{
    setLookupError('');setSuccess(false);const cnpj=normalizeCnpj(data.cnpj);
    request.current?.abort();const controller=new AbortController();request.current=controller;setLooking(true);
    try{const details=await fetchClientCnpj(cnpj,controller.signal);if(!controller.signal.aborted){setData(details);setSuccess(true);}}
    catch(error){if(!controller.signal.aborted){setLookupError((error as Error).message);if(error instanceof ClientApiError&&error.status===401)setAuth(true);}}
    finally{if(!controller.signal.aborted)setLooking(false);}
  };
  return <form className="client-form" onSubmit={async event=>{
    event.preventDefault();if(saving||looking)return;setError('');
    try{setSaving(true);const saved=await mutation.mutateAsync({input:data,id:client?.id});if(mounted.current){if(client)notifications.updated('O cadastro do parceiro foi atualizado.');else notifications.created('O parceiro foi cadastrado.');navigate(clientHref(saved.id));}}
    catch(error){if(mounted.current){setError((error as Error).message);if(error instanceof ClientApiError&&error.status===401)setAuth(true);}}
    finally{if(mounted.current)setSaving(false);}
  }}>
    <div className="cnpj-lookup-panel"><label htmlFor="client-cnpj">CNPJ do parceiro</label><div className="cnpj-lookup-row"><input id="client-cnpj" name="cnpj" required value={data.cnpj} maxLength={18} placeholder="00.000.000/0000-00" autoComplete="off" disabled={saving||looking} onChange={e=>{change('cnpj',e.target.value.toUpperCase());setSuccess(false);setLookupError('');}}/><button type="button" className="btn company-primary" disabled={saving||looking||!data.cnpj.trim()} onClick={consult}>{looking?<Loader2 size={16} className="animate-spin"/>:<Search size={16}/>} {looking?'Consultando…':'Consultar CNPJ'}</button></div><p className="field-help">Consulta gratuita em bases públicas. Os dados também podem ser preenchidos manualmente.</p>{success&&<p className="lookup-success" role="status"><Check size={15}/>Dados preenchidos. Revise antes de salvar.</p>}{looking&&<p className="field-help" role="status">Consultando os dados do parceiro…</p>}{lookupError&&<p className="form-error" role="alert">{lookupError}</p>}</div>
    <fieldset disabled={saving||looking} className="company-fieldset"><section className="client-form-section"><h3><Building2 size={17}/>Identificação</h3><div className="form-grid">{field('legalName','Razão social',true)}{field('tradeName','Nome fantasia')}</div></section>
    <section className="client-form-section"><h3><MapPin size={17}/>Endereço</h3><div className="form-grid client-street-grid">{field('street','Logradouro')}{field('number','Número')}</div><div className="form-grid">{field('complement','Complemento')}{field('district','Bairro')}</div><div className="form-grid client-city-grid">{field('city','Cidade')}{field('state','UF')}{field('zipCode','CEP')}</div></section>
    <section className="client-form-section"><h3><Phone size={17}/>Contato</h3><div className="form-grid">{field('phone','Telefone',false,'tel')}{field('email','E-mail',false,'email')}</div></section></fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}{auth&&<Link className="client-signin" href="/login?returnTo=%2Fcadastro%3Fsecao%3Dclientes" target="_top">Entrar para cadastrar</Link>}
    <div className="form-actions"><ModuleLink href={client?clientHref(client.id):clientsHref} className="btn" aria-disabled={saving} onClick={event=>{if(saving)event.preventDefault();}}>Cancelar</ModuleLink><button className="btn company-primary" disabled={saving||looking}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?'Salvando…':client?'Salvar alterações':'Cadastrar parceiro'}</button></div>
  </form>;
}
