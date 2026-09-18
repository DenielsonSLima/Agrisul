'use client';

import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ChevronLeft, ChevronRight, FileSignature, Loader2, Pencil, Plus, Power, RefreshCw, Search} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {notifications, useConfirmation} from '@/shared/feedback';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {SignatureForm, type SignatureFormHandle} from '../forms/SignatureForm';
import {useSignatures} from '../hooks/useSignatures';
import {signatureRoleLabels, type Signature, type SignatureFilters, type SignatureStatus} from '../types';
import {SignaturePreview} from './SignaturePreview';
import '../styles.css';

export function AssinaturasPage() {
  const {user} = useAuth();
  return <SignaturesWorkspace key={user?.id ?? 'anonymous'}/>;
}

function SignaturesWorkspace() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<SignatureFilters>({search: '', page: 1, pageSize: 12, status: 'active'});
  const model = useSignatures(filters);
  const confirm = useConfirmation();
  const [draft, setDraft] = useState<Signature>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionId, setActionId] = useState('');
  const [actionError, setActionError] = useState('');
  const formRef = useRef<SignatureFormHandle>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {
    const timer = setTimeout(() => setFilters(previous => previous.search === search ? previous : {...previous, search, page: 1}), 300);
    return () => clearTimeout(timer);
  }, [search]);
  if (!model.loading && !model.error && model.page !== filters.page) setFilters({...filters, page: model.page});

  const begin = (signature?: Signature) => {lastTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDraft(signature); setActionError(''); setBusy(false); setOpen(true);};
  const deactivate = async (signature: Signature) => {
    const accepted = await confirm({
      title: `Inativar assinatura de ${signature.name}?`,
      description: 'Esta assinatura deixará de estar disponível para novas solicitações e aprovações. Os registros anteriores e suas assinaturas serão preservados.',
      confirmLabel: 'Inativar assinatura', tone: 'destructive',
    });
    if (!accepted || !mounted.current) return;
    setActionId(signature.id); setActionError('');
    try {
      await model.deactivate(signature.id);
      if (mounted.current) notifications.updated('A assinatura foi inativada. O histórico foi preservado.');
    } catch (caught) {
      if (mounted.current) {const message = (caught as Error).message; setActionError(message); notifications.error(message);}
    } finally {if (mounted.current) setActionId('');}
  };
  const totalPages = Math.max(1, Math.ceil(model.total / model.pageSize));

  return <section className="signatures-workspace">
    <div className="client-navigation">
      <nav className="client-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><ChevronRight size={13}/><span aria-current="page">Assinaturas</span></nav>
      <ModuleLink className="client-back" href="/cadastro"><ArrowLeft size={15}/>Voltar aos cadastros</ModuleLink>
    </div>
    <div className="companies-heading">
      <div><h2>Assinaturas</h2><p>Cadastre solicitantes e diretores gerais. A imagem PNG da assinatura é opcional.</p></div>
      {model.canManage && <button type="button" className="btn company-primary" onClick={() => begin()} disabled={model.saving}><Plus size={16}/>Cadastrar assinatura</button>}
    </div>
    <div className="signatures-toolbar">
      <label className="signatures-search"><Search size={17}/><input type="search" value={search} maxLength={150} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome" aria-label="Buscar assinaturas por nome"/></label>
      <label className="signatures-status-filter"><span>Situação</span><select className="signature-select" value={filters.status} onChange={event => setFilters(previous => ({...previous, status: event.target.value as SignatureStatus, page: 1}))}><option value="active">Ativas</option><option value="inactive">Inativas</option><option value="all">Todas</option></select></label>
    </div>
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    {model.loading ? <div className="client-loading" role="status"><Loader2 className="animate-spin" size={20}/>Carregando assinaturas…</div>
      : model.error ? <div className="company-empty" role="alert"><h3>Não foi possível carregar as assinaturas</h3><p>{model.error}</p><button type="button" className="btn" onClick={() => void model.reload()}><RefreshCw size={16}/>Tentar novamente</button></div>
        : !model.items.length ? <div className="company-empty"><span className="company-empty-icon"><FileSignature size={27}/></span><h3>{filters.search ? 'Nenhuma assinatura encontrada' : filters.status === 'inactive' ? 'Nenhuma assinatura inativa' : 'Cadastre as assinaturas dos responsáveis'}</h3><p>{filters.search ? 'Altere a busca para encontrar outro responsável.' : 'O nome basta para cadastrar solicitantes. O diretor geral também deve ser vinculado à conta que registrará as decisões. A imagem PNG é opcional.'}</p>{model.canManage && filters.status !== 'inactive' && !filters.search && <button type="button" className="btn company-primary" onClick={() => begin()}><Plus size={16}/>Cadastrar assinatura</button>}</div>
          : <>
            <div className="signatures-table-wrap"><table className="signatures-table"><thead><tr><th scope="col">Responsável</th><th scope="col">Função</th><th scope="col">Assinatura</th><th scope="col">Situação</th>{model.canManage && <th scope="col" className="signatures-actions-heading">Ações</th>}</tr></thead><tbody>
              {model.items.map(signature => <tr key={signature.id}>
                <td><strong>{signature.name}</strong><small>{signature.role === 'requester' ? 'Pessoa cadastrada' : model.users.find(user => user.id === signature.userId)?.name ?? 'Usuário vinculado'}</small></td>
                <td>{signatureRoleLabels[signature.role]}</td>
                <td><SignaturePreview path={signature.filePath} name={signature.name}/></td>
                <td><span className={`signature-status ${signature.active ? 'active' : 'inactive'}`}>{signature.active ? 'Ativa' : 'Inativa'}</span></td>
                {model.canManage && <td><div className="signatures-row-actions"><button type="button" className="btn small" onClick={() => begin(signature)} disabled={model.saving} aria-label={`${signature.active ? 'Editar' : 'Reativar'} assinatura de ${signature.name}`}><Pencil size={14}/>{signature.active ? 'Editar' : 'Reativar'}</button>{signature.active && <button type="button" className="icon-btn signatures-deactivate" title="Inativar assinatura" aria-label={`Inativar assinatura de ${signature.name}`} onClick={() => void deactivate(signature)} disabled={model.saving || !!actionId}>{actionId === signature.id ? <Loader2 className="animate-spin" size={15}/> : <Power size={15}/>}</button>}</div></td>}
              </tr>)}
            </tbody></table></div>
            <nav className="signatures-pagination" aria-label="Paginação das assinaturas"><span>{model.total} assinatura{model.total === 1 ? '' : 's'}</span><div><button className="btn" type="button" disabled={model.page <= 1} onClick={() => setFilters(previous => ({...previous, page: model.page - 1}))}><ChevronLeft size={15}/>Anterior</button><span>Página {model.page} de {totalPages}</span><button className="btn" type="button" disabled={model.page >= totalPages} onClick={() => setFilters(previous => ({...previous, page: model.page + 1}))}>Próxima<ChevronRight size={15}/></button></div></nav>
          </>}
    <Dialog open={open} onOpenChange={next => {if (!next && !busy) void formRef.current?.requestClose();}}><DialogContent className="form-modal signature-modal" showCloseButton={!busy} onEscapeKeyDown={event => {if (busy) event.preventDefault();}} onPointerDownOutside={event => {if (busy) event.preventDefault();}} onCloseAutoFocus={event => {event.preventDefault(); if (lastTrigger.current?.isConnected) lastTrigger.current.focus();}}><DialogHeader><DialogTitle>{draft ? draft.active ? 'Editar assinatura' : 'Reativar assinatura' : 'Cadastrar assinatura'}</DialogTitle><DialogDescription>Informe o responsável e, se desejar, adicione a imagem PNG da assinatura.</DialogDescription></DialogHeader><SignatureForm ref={formRef} key={draft?.id ?? 'new'} signature={draft} users={model.users} onSave={model.save} onBusy={setBusy} onClose={() => {setBusy(false); setOpen(false);}}/></DialogContent></Dialog>
  </section>;
}
