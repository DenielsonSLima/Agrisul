'use client';
import {useEffect, useRef, useState} from 'react';
import {Building2, Check, Loader2, MapPin, Phone, Save, Search, UserRound} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {notifications, useConfirmation} from '@/shared/feedback';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {clientLimits} from '../../clientes/utils/clientFields';
import {useProviderMutation} from '../hooks/useProviders';
import {lookupProviderCnpj} from '../services/providerApi';
import {emptyProvider, type ProviderInput, type ServiceProvider} from '../types';

export function ProviderForm({provider, onSaved, onClose}: {provider?: ServiceProvider; onSaved: (value: ServiceProvider) => void; onClose: () => void}) {
  const [initial] = useState<ProviderInput>(() => provider ? Object.fromEntries(Object.keys(emptyProvider).map(key => [key, provider[key as keyof ProviderInput]])) as ProviderInput : {...emptyProvider});
  const [data, setData] = useState(initial);
  const [looking, setLooking] = useState(false), [error, setError] = useState(''), [lookupError, setLookupError] = useState(''), [filled, setFilled] = useState(false);
  const lookup = useRef<AbortController | null>(null), mounted = useRef(true), submitting = useRef(false);
  const operation = useRef<AbortController | null>(null), {user} = useAuth();
  const mutation = useProviderMutation(), confirm = useConfirmation();
  const busy = looking || mutation.isPending;
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; lookup.current?.abort();operation.current?.abort();};}, []);
  const change = (key: keyof ProviderInput, value: string) => setData(current => ({...current, [key]: value}));
  const close = async () => {
    if (submitting.current || looking) return;
    if (JSON.stringify(data) !== JSON.stringify(initial) && !await confirm({title: 'Descartar alterações do prestador?', description: 'Os dados preenchidos ainda não foram salvos.', confirmLabel: 'Descartar alterações', tone: 'destructive'})) return;
    if (mounted.current) onClose();
  };
  const consult = async () => {
    if (busy || data.documentType !== 'CNPJ') return;
    lookup.current?.abort();const controller = new AbortController();lookup.current = controller;
    setLooking(true);setFilled(false);setLookupError('');
    try {const details = await lookupProviderCnpj(data.document, controller.signal);if (!controller.signal.aborted) {setData(details);setFilled(true);}}
    catch (caught) {if (!controller.signal.aborted) setLookupError((caught as Error).message);}
    finally {if (!controller.signal.aborted) setLooking(false);}
  };
  const field = (key: Exclude<keyof ProviderInput, 'documentType' | 'document'>, label: string, required = false, type = 'text') => <Field label={label}><input name={key} type={type} value={data[key]} maxLength={clientLimits[key]} required={required} onChange={event => change(key, event.target.value)}/></Field>;
  return <Dialog open onOpenChange={open => {if (!open) void close();}}><DialogContent className="form-modal provider-modal" showCloseButton={!busy} onEscapeKeyDown={event => {if (busy) event.preventDefault();}} onPointerDownOutside={event => {if (busy) event.preventDefault();}}>
    <DialogHeader><DialogTitle>{provider ? 'Editar prestador' : 'Novo prestador'}</DialogTitle><DialogDescription>Cadastre a pessoa ou empresa que executará o serviço.</DialogDescription></DialogHeader>
    <form className="client-form provider-form" aria-busy={busy} onSubmit={async event => {
      event.preventDefault();event.stopPropagation();if (submitting.current || looking) return;submitting.current = true;setError('');
      const controller = new AbortController();operation.current = controller;
      try {const saved = await mutation.mutateAsync({input: data, id: provider?.id, execution: {actorId: user?.id ?? '', signal: controller.signal}});if (mounted.current) {if (provider) notifications.updated('O cadastro do prestador foi atualizado.');else notifications.created('O prestador foi cadastrado.');onSaved(saved);}}
      catch (caught) {if (mounted.current) {setError((caught as Error).message);notifications.error((caught as Error).message);}}
      finally {submitting.current = false;}
    }}>
      <fieldset className="company-fieldset" disabled={busy}>
        <div className="cnpj-lookup-panel"><fieldset className="provider-document-types"><legend>Tipo de pessoa</legend>{(['CNPJ', 'CPF'] as const).map(type => <label key={type}><input type="radio" name="documentType" value={type} checked={data.documentType === type} onChange={() => {setData(current => ({...current, documentType: type, document: ''}));setFilled(false);setLookupError('');}}/>{type === 'CNPJ' ? 'Pessoa jurídica — CNPJ' : 'Pessoa física — CPF'}</label>)}</fieldset>
          <label htmlFor="provider-document">{data.documentType} do prestador *</label><div className="cnpj-lookup-row"><input id="provider-document" name="document" required value={data.document} maxLength={data.documentType === 'CPF' ? 14 : 18} inputMode={data.documentType === 'CPF' ? 'numeric' : 'text'} placeholder={data.documentType === 'CPF' ? '000.000.000-00' : '00.000.000/0000-00'} autoComplete="off" onChange={event => {change('document', event.target.value.toUpperCase());setFilled(false);setLookupError('');}}/>{data.documentType === 'CNPJ' && <button type="button" className="btn company-primary" disabled={busy || !data.document.trim()} onClick={() => void consult()}>{looking ? <Loader2 size={16} className="animate-spin"/> : <Search size={16}/>}Consultar CNPJ</button>}</div>
          <p className="field-help">{data.documentType === 'CNPJ' ? 'Consulte o CNPJ para preencher os dados ou preencha manualmente.' : 'Preencha o nome, o endereço e os contatos da pessoa.'}</p>{filled && <p className="lookup-success" role="status"><Check size={15}/>Dados preenchidos. Revise antes de salvar.</p>}{lookupError && <p className="form-error" role="alert">{lookupError}</p>}
        </div>
        <section className="client-form-section"><h3>{data.documentType === 'CPF' ? <UserRound size={17}/> : <Building2 size={17}/>}Identificação</h3><div className="form-grid">{field('legalName', data.documentType === 'CPF' ? 'Nome completo *' : 'Razão social *', true)}{field('tradeName', data.documentType === 'CPF' ? 'Nome profissional / apelido' : 'Nome fantasia')}</div></section>
        <section className="client-form-section"><h3><MapPin size={17}/>Endereço</h3><div className="form-grid client-street-grid">{field('street', 'Logradouro')}{field('number', 'Número')}</div><div className="form-grid">{field('complement', 'Complemento')}{field('district', 'Bairro')}</div><div className="form-grid client-city-grid">{field('city', 'Cidade')}{field('state', 'UF')}{field('zipCode', 'CEP')}</div></section>
        <section className="client-form-section"><h3><Phone size={17}/>Contato</h3><div className="form-grid">{field('phone', 'Telefone', false, 'tel')}{field('email', 'E-mail', false, 'email')}</div></section>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={() => void close()}>Cancelar</button><button type="submit" className="btn company-primary" disabled={busy}>{mutation.isPending ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>} {mutation.isPending ? 'Salvando…' : provider ? 'Salvar alterações' : 'Cadastrar prestador'}</button></div>
    </form>
  </DialogContent></Dialog>;
}
