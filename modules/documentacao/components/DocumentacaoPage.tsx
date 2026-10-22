'use client';
import {useState, type FormEvent} from 'react';
import {ArrowLeft, ArrowRight, FilePlus2, FolderOpen, Search} from 'lucide-react';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {ModuleLink, useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {dateLabel} from '@/shared/utils/presentation';
import {useDocumentOptions, useDocuments} from '../hooks/useDocumentation';
import {documentKinds, documentStatuses, type DocumentFilters, type DocumentSource, type SourceType} from '../types';
import {DocumentState, DocumentTable, documentationHref} from './DocumentElements';
import {DocumentForm, SourcePicker} from './DocumentForm';
import {DocumentDetail} from './DocumentDetail';
import {DocumentationPanel, ExpectationForm, sourceDocumentationHref} from './DocumentationPanel';
import '../styles.css';

const documentationTabs = {todos: 'Todos', servico: 'Serviço', compra: 'Compra', pendentes: 'Pendentes'} as const;
type DocumentationTab = keyof typeof documentationTabs;

export function DocumentacaoPage() {
  const {user} = useAuth();
  return <DocumentationWorkspace key={user?.id ?? 'anonymous'}/>;
}
function DocumentationWorkspace() {
  const {searchParams} = useModuleNavigation();
  const id = searchParams.get('documento');
  const sourceId = searchParams.get('origem');
  const type = searchParams.get('tipo') as SourceType;
  if (id) return <DocumentDetail key={id} id={id}/>;
  if (sourceId && ['service', 'quotation', 'order'].includes(type)) return <section className="documentation-page"><ModuleLink className="documentation-back" href="/documentacao"><ArrowLeft size={16}/>Voltar para Documentação</ModuleLink><div className="documentation-heading"><div><span className="eyebrow">ARQUIVOS E PENDÊNCIAS</span><h2>Documentação da referência</h2></div></div><DocumentationPanel key={`${type}:${sourceId}`} source={{type, id: sourceId}}/></section>;
  return <DocumentationList/>;
}
function DocumentationList() {
  const {searchParams, navigate} = useModuleNavigation();
  const requestedTab = searchParams.get('aba');
  const tab: DocumentationTab = requestedTab === 'pendencias' || requestedTab === 'pendentes' ? 'pendentes' : requestedTab === 'servico' || requestedTab === 'compra' ? requestedTab : 'todos';
  const rawPage = searchParams.get('pagina') ?? '1';
  const filters: DocumentFilters = {sourceCategory: tab === 'servico' ? 'service' : tab === 'compra' ? 'purchase' : '', search: searchParams.get('busca') ?? '', kind: searchParams.get('tipoDocumento') ?? '', status: searchParams.get('situacao') ?? '', providerId: searchParams.get('fornecedor') ?? '', dateFrom: searchParams.get('de') ?? '', dateTo: searchParams.get('ate') ?? '', page: /^[1-9]\d{0,4}$/.test(rawPage) ? Number(rawPage) : 1};
  const query = useDocuments(filters);
  const options = useDocumentOptions();
  const [adding, setAdding] = useState(false);
  const [expectation, setExpectation] = useState(false);
  const [choosingSource, setChoosingSource] = useState(false);
  const [selectedSources, setSelectedSources] = useState<DocumentSource[]>([]);
  const change = (patch: Partial<DocumentFilters>, nextTab: DocumentationTab = tab) => {
    const next = {...filters, ...patch};const params = new URLSearchParams();
    if (nextTab !== 'todos') params.set('aba', nextTab);
    for (const [key, value] of Object.entries({busca: next.search, tipoDocumento: next.kind, situacao: next.status, fornecedor: next.providerId, de: next.dateFrom, ate: next.dateTo, pagina: next.page > 1 ? String(next.page) : ''})) if (value) params.set(key, value);
    navigate(`/documentacao${params.size ? `?${params}` : ''}`);
  };
  const canManage = query.data?.canManage ?? options.data?.canManage;
  return <section className="documentation-page">
    <div className="documentation-heading"><div><span className="eyebrow">ARQUIVOS E PENDÊNCIAS</span><h2><FolderOpen size={27}/>Documentação</h2><p>Encontre notas, boletos e comprovantes junto das suas compras e serviços.</p></div><div className="documentation-actions"><button className="btn" type="button" onClick={() => setChoosingSource(true)}>Abrir pasta de referência</button>{canManage && <><button className="btn" type="button" onClick={() => setExpectation(true)}>Registrar pendência</button><button className="btn company-primary" type="button" onClick={() => setAdding(true)}><FilePlus2 size={17}/>Adicionar documento</button></>}</div></div>
    <Tabs value={tab} onValueChange={value => change({page: 1}, value as DocumentationTab)}><TabsList variant="line" aria-label="Áreas de Documentação">{Object.entries(documentationTabs).map(([value, label]) => <TabsTrigger key={value} value={value}>{label}{query.data && value === tab && <span>{tab === 'pendentes' ? query.data.pendingTotal : query.data.total}</span>}</TabsTrigger>)}</TabsList>
      <DocumentFiltersBar key={JSON.stringify(filters)} filters={filters} providers={options.data?.providers ?? []} onApply={patch => change({...patch, page: 1})}/>
      <DocumentState loading={query.loading} error={query.error} retry={() => void query.reload()}/>
      {tab !== 'pendentes' && <TabsContent value={tab}>{query.data && <><DocumentTable documents={query.data.documents}/><div className="documentation-pagination"><span>{query.data.total} documento(s) · Página {filters.page}</span><button className="btn" disabled={filters.page <= 1} type="button" onClick={() => change({page: filters.page - 1})}><ArrowLeft size={15}/>Anterior</button><button className="btn" disabled={filters.page * query.data.pageSize >= query.data.total} type="button" onClick={() => change({page: filters.page + 1})}>Próxima<ArrowRight size={15}/></button></div></>}</TabsContent>}
      <TabsContent value="pendentes">{query.data && <><p className="documentation-help">Pendências documentais. O vencimento de um boleto não é usado para presumir falta de pagamento.</p>{query.data.pending.length ? <div className="documentation-pending-list">{query.data.pending.map(item => <article key={`${item.reason}:${item.id}`} className={`documentation-pending ${item.overdue ? 'is-overdue' : ''}`}><div><span className="documentation-badge">{{missing: 'Falta documento', review: 'A conferir', divergent: 'Com divergência', unlinked: 'Aguardando identificação'}[item.reason]}</span><h3>{item.title}</h3><p>{documentKinds[item.kind]}{item.source?.description ? ` · ${item.source.description}` : ''}</p>{item.notes && <p>{item.notes}</p>}{item.dueOn && <small>{item.overdue ? 'Prazo vencido' : 'Prazo'}: {dateLabel(item.dueOn)}</small>}</div><ModuleLink className="btn" href={item.documentId ? documentationHref(item.documentId) : item.source ? sourceDocumentationHref(item.source) : '/documentacao'}>Resolver<ArrowRight size={15}/></ModuleLink></article>)}</div> : <div className="documentation-empty"><FolderOpen size={30}/><h3>Nenhuma pendência encontrada</h3><p>Registre os documentos esperados para acompanhar o que ainda falta receber.</p></div>}</>}</TabsContent>
      {tab === 'pendentes' && query.data && <div className="documentation-pagination"><span>{query.data.pendingTotal} pendência(s) · Página {filters.page}</span><button className="btn" type="button" disabled={filters.page <= 1} onClick={() => change({page: filters.page - 1})}>Anterior</button><button className="btn" type="button" disabled={filters.page * 30 >= query.data.pendingTotal} onClick={() => change({page: filters.page + 1})}>Próxima</button></div>}
    </Tabs>
    {adding && <DocumentForm onClose={() => setAdding(false)} onSaved={id => {setAdding(false);navigate(documentationHref(id));}}/>}
    {expectation && <ExpectationForm onClose={() => setExpectation(false)}/>}
    {choosingSource && <Dialog open onOpenChange={open => {if (!open) setChoosingSource(false);}}><DialogContent className="documentation-form-dialog"><DialogTitle>Abrir documentação de uma referência</DialogTitle><DialogDescription>Localize a compra ou o serviço para consultar seus arquivos e documentos esperados.</DialogDescription><SourcePicker selected={selectedSources} onChange={sources => setSelectedSources(sources.slice(-1))}/><div className="documentation-form-actions"><button className="btn" type="button" onClick={() => setChoosingSource(false)}>Voltar</button><button className="btn company-primary" type="button" disabled={!selectedSources.length} onClick={() => {setChoosingSource(false);navigate(sourceDocumentationHref(selectedSources[0]));}}>Abrir pasta</button></div></DialogContent></Dialog>}
  </section>;
}
function DocumentFiltersBar({filters, providers, onApply}: {filters: DocumentFilters; providers: {id: string; name: string}[]; onApply: (filters: DocumentFilters) => void}) {
  const [draft, setDraft] = useState(filters);
  const submit = (event: FormEvent) => {event.preventDefault();onApply(draft);};
  return <form className="documentation-filters" onSubmit={submit}><label className="documentation-filter-search">Buscar documento<input value={draft.search} maxLength={200} onChange={e => setDraft({...draft, search: e.target.value})} placeholder="Fornecedor, CNPJ, nota, pedido, OC, equipamento ou arquivo"/></label>
    <label>Tipo<select value={draft.kind} onChange={e => setDraft({...draft, kind: e.target.value})}><option value="">Todos</option>{Object.entries(documentKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Situação<select value={draft.status} onChange={e => setDraft({...draft, status: e.target.value})}><option value="">Todas</option>{Object.entries(documentStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Fornecedor<select value={draft.providerId} onChange={e => setDraft({...draft, providerId: e.target.value})}><option value="">Todos</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
    <label>Emissão / cadastro de<input type="date" value={draft.dateFrom} onChange={e => setDraft({...draft, dateFrom: e.target.value})}/></label><label>Até<input type="date" value={draft.dateTo} onChange={e => setDraft({...draft, dateTo: e.target.value})}/></label>
    <button className="btn company-primary" type="submit"><Search size={15}/>Filtrar</button><button className="btn" type="button" onClick={() => onApply({search: '', kind: '', status: '', providerId: '', dateFrom: '', dateTo: '', page: 1})}>Limpar</button>
  </form>;
}
