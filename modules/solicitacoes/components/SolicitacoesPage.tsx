'use client';
import {useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, ClipboardList, Clock3, FileText, LayoutGrid, List, Paperclip, Plus, ShieldCheck, Wrench} from 'lucide-react';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {notifications} from '@/shared/feedback';
import {ModuleLink, useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {moneyLabel} from '@/shared/utils/presentation';
import {ServiceRequestForm, type ServiceRequestFormHandle} from '../forms/ServiceRequestForm';
import {useRequestCollection, useRequestDetail, useRequestMutations, useRequestOptions} from '../hooks/useServiceRequests';
import {assertRequestActor} from '../services/requestApi';
import type {RequestFilters as Filters} from '../types';
import {RequestFilters} from './RequestFilters';
import {RequestError, RequestLoading, RequestWorkflowBadge, requestTimestamp} from './RequestPresentation';
import {ServiceRequestDetail} from './ServiceRequestDetail';
import {ServiceRequestCard} from './ServiceRequestCard';
import '../styles.css';

function requestHref(filters: Filters, extra: {id?: string; create?: boolean; management?: boolean; view?: 'cards' | 'table'} = {}) {
  const params = new URLSearchParams({secao: 'servico'});
  if (filters.tab !== 'pending') params.set('aba', filters.tab);
  if (filters.search) params.set('busca', filters.search);
  if (filters.dateFrom) params.set('de', filters.dateFrom);
  if (filters.dateTo) params.set('ate', filters.dateTo);
  if (filters.requesterId) params.set('solicitante', filters.requesterId);
  if (filters.page > 1) params.set('pagina', String(filters.page));
  if (extra.id) params.set('solicitacao', extra.id);
  if (extra.create) params.set('nova', '1');
  if (extra.management) params.set('gerencia', '1');
  if (extra.view === 'table') params.set('visualizacao', 'tabela');
  return `/solicitacoes?${params.toString()}`;
}

export function SolicitacoesPage() {
  const {user} = useAuth();
  return <SolicitacoesWorkspace key={user?.id ?? 'anonymous'}/>;
}

function SolicitacoesWorkspace() {
  const {searchParams, navigate} = useModuleNavigation();
  const selected = searchParams.get('secao') === 'servico';
  const id = selected ? searchParams.get('solicitacao') ?? '' : '';
  const create = selected && searchParams.get('nova') === '1' && !id;
  const [formBusy, setFormBusy] = useState(false);
  const formRef = useRef<ServiceRequestFormHandle>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const management = searchParams.get('gerencia') === '1';
  const view = searchParams.get('visualizacao') === 'tabela' ? 'table' : 'cards';
  const rawPage = searchParams.get('pagina') ?? '1';
  const filters: Filters = {
    search: (searchParams.get('busca') ?? '').slice(0, 160),
    dateFrom: searchParams.get('de') ?? '',
    dateTo: searchParams.get('ate') ?? '',
    requesterId: searchParams.get('solicitante') ?? '',
    tab: searchParams.get('aba') === 'finished' ? 'finished' : searchParams.get('aba') === 'in_progress' ? 'in_progress' : 'pending',
    page: /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : 1,
    pageSize: 12,
  };
  const options = useRequestOptions();
  // Keep the list subscribed while a request is open so awaited mutation
  // invalidation also refreshes cards before returning to the collection.
  const collection = useRequestCollection(filters, selected);
  const detail = useRequestDetail(id);
  const mutations = useRequestMutations();
  const listHref = requestHref(filters, {management, view});
  const changeFilters = (next: Partial<Filters>) => navigate(requestHref({...filters, ...next}, {management, view}));
  const detailHref = (requestId: string) => requestHref(filters, {id: requestId, management, view});

  if (options.loading) return <section className="requests-workspace"><RequestLoading/></section>;
  if (!options.data) return <section className="requests-workspace"><RequestError error={options.error || 'As opções de solicitação não estão disponíveis.'} onRetry={() => void options.reload()}/></section>;
  const context = options.data;
  const canCreate = context.canCreate;

  return <section className="requests-workspace">
    <nav className="request-breadcrumb" aria-label="Caminho da solicitação"><ModuleLink href="/solicitacoes">Solicitações</ModuleLink>{selected && <><ChevronRight size={13}/>{id ? <ModuleLink href={listHref}>Serviço</ModuleLink> : <span aria-current="page">Serviço</span>}</>}{id && <><ChevronRight size={13}/><span aria-current="page">{detail.data ? `Nº ${detail.data.number}` : 'Detalhes'}</span></>}</nav>
    {!selected ? <><div className="request-heading"><div><span className="eyebrow">CONTROLE INTERNO</span><h2>Solicitações</h2><p>Registre serviços, reúna os orçamentos e acompanhe a aprovação.</p></div></div><div className="request-module-grid"><ModuleLink href="/solicitacoes?secao=servico" className="request-module-card"><span className="request-module-icon"><Wrench size={28}/></span><div><h3>Serviço</h3><p>Solicitações com equipamentos, materiais, orçamento e assinaturas.</p><span>Abrir solicitações<ArrowRight size={16}/></span></div></ModuleLink>{context.canDecide && <ModuleLink href="/solicitacoes?secao=servico&gerencia=1" className="request-module-card request-manager-card"><span className="request-module-icon"><ShieldCheck size={28}/></span><div><h3>Análise do diretor geral</h3><p>Consulte os documentos e registre a aprovação ou a recusa.</p><span>Abrir fila de aprovação<ArrowRight size={16}/></span></div></ModuleLink>}</div><div className="request-flow-note"><ClipboardList size={20}/><p><strong>Do pedido à decisão, em um só lugar.</strong><span>Você registra o pedido e o orçamento. O diretor geral analisa e o histórico preserva os responsáveis e os horários.</span></p></div></>
    : id ? detail.loading ? <RequestLoading label="Carregando solicitação…"/> : detail.error || !detail.data ? <><button className="request-back" onClick={() => navigate(listHref)}><ArrowLeft size={16}/>Voltar para serviços</button><RequestError error={detail.error || 'Solicitação não encontrada.'} onRetry={() => void detail.reload()}/></> : <ServiceRequestDetail key={detail.data.id} request={detail.data} options={context} onBack={() => navigate(listHref)} onDecide={mutations.decide} deciding={mutations.deciding}/>
    : <><ModuleLink className="request-back" href="/solicitacoes"><ArrowLeft size={16}/>Voltar para solicitações</ModuleLink><div className="request-heading"><div><span className="eyebrow">SOLICITAÇÕES / SERVIÇO</span><h2>{management ? 'Análise das solicitações' : 'Solicitações de serviço'}</h2><p>{management ? 'Analise os orçamentos e registre a decisão em cada solicitação.' : 'Acompanhe os serviços solicitados e as decisões do diretor geral.'}</p></div><button ref={createButton} type="button" className="btn company-primary" disabled={!canCreate} onClick={() => {setFormBusy(false); navigate(requestHref(filters, {create: true, management, view}));}}><Plus size={17}/>Nova solicitação</button></div>
      {context.canCreate && !context.requesterSignatures?.length && <div className="request-notice"><strong>Cadastre os solicitantes.</strong><p>Informe o nome das pessoas. A imagem PNG da assinatura é opcional. Na nova solicitação, você escolherá quem pediu o serviço.</p><ModuleLink href="/cadastro?secao=assinaturas">Abrir assinaturas</ModuleLink></div>}
      <Tabs value={filters.tab} onValueChange={value => changeFilters({tab: value === 'finished' ? 'finished' : value === 'in_progress' ? 'in_progress' : 'pending', page: 1})} className="request-tabs"><TabsList variant="line" aria-label="Situação das solicitações"><TabsTrigger value="pending"><Clock3 size={16}/>Abertas{collection.data && <span className="request-tab-count">{collection.data.counts.pending}</span>}</TabsTrigger><TabsTrigger value="in_progress"><CircleDot size={16}/>Em andamento{collection.data && <span className="request-tab-count">{collection.data.counts.inProgress ?? 0}</span>}</TabsTrigger><TabsTrigger value="finished"><CheckCircle2 size={16}/>Finalizadas{collection.data && <span className="request-tab-count">{collection.data.counts.finished}</span>}</TabsTrigger></TabsList>
        <TabsContent value={filters.tab}><RequestFilters key={`${filters.search}:${filters.dateFrom}:${filters.dateTo}:${filters.requesterId}`} filters={filters} requesters={context.requesters} onApply={changeFilters}/>
          {collection.loading ? <RequestLoading/> : collection.error || !collection.data ? <RequestError error={collection.error || 'Não foi possível consultar solicitações.'} onRetry={() => void collection.reload()}/> : <><div className="request-list-summary"><span><strong>{collection.data.total}</strong> {collection.data.total === 1 ? 'solicitação encontrada' : 'solicitações encontradas'}</span><div className="request-view-controls"><span>Período pela data de solicitação</span><div className="request-view-toggle" role="group" aria-label="Visualização das solicitações"><button type="button" aria-pressed={view === 'cards'} onClick={() => navigate(requestHref(filters, {management, view: 'cards'}))}><LayoutGrid size={15}/>Cards</button><button type="button" aria-pressed={view === 'table'} onClick={() => navigate(requestHref(filters, {management, view: 'table'}))}><List size={15}/>Tabela</button></div></div></div>
            {!collection.data.items.length ? <div className="request-empty"><span className="request-empty-icon"><FileText size={28}/></span><h3>{filters.search || filters.dateFrom || filters.dateTo || filters.requesterId ? 'Nenhuma solicitação com esses filtros' : filters.tab === 'pending' ? 'Nenhuma solicitação aberta' : filters.tab === 'in_progress' ? 'Nenhum serviço em andamento' : 'Nenhuma solicitação finalizada'}</h3><p>{filters.tab === 'finished' ? 'Serviços concluídos e solicitações recusadas aparecem nesta aba.' : filters.tab === 'in_progress' ? 'Os serviços aprovados ficam aqui até você registrar a conclusão.' : 'As novas solicitações ficam aqui até a decisão do diretor geral.'}</p>{canCreate && filters.tab === 'pending' && <button className="btn" onClick={() => navigate(requestHref(filters, {create: true, management, view}))}><Plus size={16}/>Criar solicitação</button>}</div>
            : view === 'cards' ? <div className="request-card-grid">{collection.data.items.map(request => <ServiceRequestCard key={request.id} request={request} href={detailHref(request.id)}/>)}</div> : <div className="request-table-wrap"><table className="request-table"><thead><tr><th scope="col">Solicitação / prestador</th><th scope="col">Solicitante</th><th scope="col">Data e hora</th><th scope="col">Valor</th><th scope="col">Situação</th><th scope="col"><span className="sr-only">Abrir</span></th></tr></thead><tbody>{collection.data.items.map(request => <tr key={request.id}><td><ModuleLink href={detailHref(request.id)} className="request-row-title"><span>Nº {request.number}</span><strong>{request.companyName}</strong></ModuleLink><span className="request-row-meta"><Paperclip size={12}/>{request.attachments.length} {request.attachments.length === 1 ? 'orçamento' : 'orçamentos'}</span></td><td>{request.requester.name}</td><td><time dateTime={request.createdAt}>{requestTimestamp(request.createdAt)}</time></td><td className="request-money">{moneyLabel((request.currentDetails ?? request).serviceValue)}</td><td><RequestWorkflowBadge status={request.workflowStatus}/></td><td><ModuleLink className="request-row-open" href={detailHref(request.id)} aria-label={`Abrir solicitação número ${request.number}`}><ArrowRight size={18}/></ModuleLink></td></tr>)}</tbody></table></div>}
            <nav className="request-pagination" aria-label="Paginação das solicitações"><span>Página {collection.data.page} de {Math.max(1, Math.ceil(collection.data.total / collection.data.pageSize))}</span><div><button type="button" className="btn" disabled={collection.data.page <= 1} onClick={() => changeFilters({page: collection.data!.page - 1})}><ChevronLeft size={16}/>Anterior</button><button type="button" className="btn" disabled={collection.data.page * collection.data.pageSize >= collection.data.total} onClick={() => changeFilters({page: collection.data!.page + 1})}>Próxima<ChevronRight size={16}/></button></div></nav>
          </>}
        </TabsContent>
      </Tabs>
    </>}
    <Dialog open={create} onOpenChange={open => {if (!open && !formBusy) void formRef.current?.requestClose();}}>
      <DialogContent className="form-modal request-modal" showCloseButton={!formBusy} onEscapeKeyDown={event => {if (formBusy || event.target instanceof Element && event.target.closest('.request-modal')?.querySelector('[role="combobox"][aria-expanded="true"]')) event.preventDefault();}} onPointerDownOutside={event => {if (formBusy) event.preventDefault();}} onCloseAutoFocus={event => {event.preventDefault(); if (createButton.current?.isConnected) createButton.current.focus();}}>
        <DialogHeader><DialogTitle>Nova solicitação</DialogTitle><DialogDescription>Selecione o solicitante e descreva o serviço. O orçamento pode ser anexado, se houver.</DialogDescription></DialogHeader>
        <ServiceRequestForm ref={formRef} options={context} onBusy={setFormBusy} onClose={() => {setFormBusy(false); navigate(listHref, {replace: true});}} onSave={async (input, execution) => {const request = await mutations.create(input, execution); await assertRequestActor(execution); notifications.created(`A solicitação nº ${request.number} foi registrada e aguarda aprovação.`); setFormBusy(false); navigate(detailHref(request.id), {replace: true}); return request;}}/>
      </DialogContent>
    </Dialog>
  </section>;
}
