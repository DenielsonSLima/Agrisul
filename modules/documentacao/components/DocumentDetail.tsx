'use client';
import {useState, type FormEvent} from 'react';
import {ArrowLeft, CheckCircle2, FileText, Loader2, Pencil, Plus} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {ModuleLink, useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {notifications, useConfirmation} from '@/shared/feedback';
import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import {useDocument, useDocumentMutations, useDocuments} from '../hooks/useDocumentation';
import {documentKinds, documentStatuses, emptyDocumentFilters, type BillingDocument, type DocumentKind, type DocumentStatus} from '../types';
import {DocumentFiles, DocumentState, DocumentTable, documentationHref, useDocumentOperation} from './DocumentElements';
import {DocumentForm} from './DocumentForm';
import {sourceDocumentationHref} from './DocumentationPanel';

function ReviewForm({document: initialDocument, onClose}: {document: BillingDocument; onClose: () => void}) {
  const [document] = useState(initialDocument);
  const [status, setStatus] = useState<DocumentStatus>('verified');
  const [note, setNote] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const candidates = useDocuments({...emptyDocumentFilters, kind: document.kind, providerId: document.providerId ?? '', search, includePending: false});
  const {review} = useDocumentMutations();
  const execution = useDocumentOperation();
  const confirm = useConfirmation();
  const save = async (event: FormEvent) => {
    event.preventDefault();setError('');if (review.isPending) return;
    const operation = execution();
    if (['cancelled', 'replaced'].includes(status) && !await confirm({title: status === 'cancelled' ? 'Cancelar este documento?' : 'Substituir este documento?', description: 'O registro e seus arquivos permanecerão no histórico. Ele deixará de atender às exigências documentais.', confirmLabel: status === 'cancelled' ? 'Cancelar documento' : 'Substituir documento', tone: 'destructive'})) return;
    try {
      await review.mutateAsync({input: {id: document.id, expectedRevision: document.revision, status, note, replacementId: status === 'replaced' ? replacementId : ''}, execution: operation});
      if (!operation.signal.aborted) {notifications.updated(`Documento: ${documentStatuses[status].toLowerCase()}.`);onClose();}
    } catch (reason) {if (!operation.signal.aborted) {const message = (reason as Error).message;setError(message);notifications.error(message);}}
  };
  return <Dialog open onOpenChange={open => {if (!open && !review.isPending) onClose();}}><DialogContent className="documentation-review-dialog"><DialogTitle>Conferência do documento</DialogTitle><DialogDescription>{document.title}. A conferência documental não registra pagamento nem recebimento físico.</DialogDescription><form onSubmit={save}><fieldset disabled={review.isPending}>
    <label>Situação<select value={status} onChange={e => setStatus(e.target.value as DocumentStatus)}>{Object.entries(documentStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {status === 'replaced' && <><label>Buscar substituição<input value={search} maxLength={200} onChange={e => setSearch(e.target.value)}/></label><label>Documento substituto<select required value={replacementId} onChange={e => setReplacementId(e.target.value)}><option value="">Selecionar documento</option>{candidates.data?.documents.filter(item => item.id !== document.id && item.providerId === document.providerId && item.companyId === document.companyId && !['cancelled', 'replaced'].includes(item.status)).map(item => <option value={item.id} key={item.id}>{item.title} · {item.documentNumber}</option>)}</select></label><DocumentState error={candidates.error}/></>}
    <label>Observação / motivo<textarea value={note} onChange={e => setNote(e.target.value)} rows={4} maxLength={2000} required={['divergent', 'cancelled', 'replaced'].includes(status)} minLength={['divergent', 'cancelled', 'replaced'].includes(status) ? 3 : undefined}/></label>
  </fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="documentation-form-actions"><button type="button" className="btn" disabled={review.isPending} onClick={onClose}>Voltar</button><button className="btn company-primary" disabled={review.isPending} type="submit">{review.isPending && <Loader2 size={15} className="animate-spin"/>}Registrar conferência</button></div></form></DialogContent></Dialog>;
}

export function DocumentDetail({id}: {id: string}) {
  const query = useDocument(id);
  const {navigate} = useModuleNavigation();
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [childKind, setChildKind] = useState<DocumentKind | null>(null);
  const document = query.data?.document;
  const active = document && !['cancelled', 'replaced'].includes(document.status);
  return <section className="documentation-detail">
    <ModuleLink className="documentation-back" href="/documentacao"><ArrowLeft size={16}/>Voltar para Documentação</ModuleLink>
    <DocumentState loading={query.loading} error={query.error} retry={() => void query.reload()}/>
    {document && <>
      <div className="documentation-heading"><div><span className="eyebrow">{documentKinds[document.kind]}</span><h2>{document.title}</h2><span className={`documentation-badge is-${document.status}`}>{documentStatuses[document.status]}</span></div>{query.data?.canManage && active && <div className="documentation-actions"><button type="button" className="btn" onClick={() => setEditing(true)}><Pencil size={15}/>Editar / anexar</button><button className="btn company-primary" type="button" onClick={() => setReviewing(true)}><CheckCircle2 size={16}/>Conferir documento</button></div>}</div>
      <div className="documentation-detail-grid"><section className="documentation-section"><h3><FileText size={18}/>Identificação</h3><dl><div><dt>Número</dt><dd>{document.documentNumber || 'Não informado'}</dd></div><div><dt>Fornecedor / prestador</dt><dd>{document.providerName ? <ModuleLink href={`/documentacao?fornecedor=${document.providerId}`}>{document.providerName}</ModuleLink> : 'Não informado'}</dd></div><div><dt>CPF / CNPJ</dt><dd>{document.providerDocument || 'Não informado'}</dd></div><div><dt>Empresa destinatária</dt><dd>{document.companyName || 'Não informada'}</dd></div><div><dt>Emissão</dt><dd>{document.issuedOn ? dateLabel(document.issuedOn) : 'Não informada'}</dd></div><div><dt>Vencimento</dt><dd>{document.dueOn ? dateLabel(document.dueOn) : 'Não informado'}</dd></div><div><dt>Valor</dt><dd>{document.amount === null ? 'Não informado' : moneyLabel(document.amount)}</dd></div></dl>{document.notes && <p className="documentation-note">{document.notes}</p>}{document.reviewNote && <p className="documentation-note"><strong>Conferência:</strong> {document.reviewNote}</p>}</section>
      <section className="documentation-section"><h3>Referências e documentos relacionados</h3>{document.sources.length ? <ul className="documentation-reference-list">{document.sources.map(source => <li key={`${source.type}:${source.id}`}><ModuleLink href={sourceDocumentationHref(source)}><strong>{source.label}</strong><small>{source.description}</small></ModuleLink><ModuleLink className="btn" href={source.href}>Abrir origem</ModuleLink></li>)}</ul> : <p>Aguardando identificação. Use “Editar / anexar” para vincular este documento.</p>}
        {document.parentId && <p>Documento principal: <ModuleLink className="text-link" href={documentationHref(document.parentId)}>{document.parentTitle || 'Abrir documento'}</ModuleLink></p>}
        {document.replacementId && <p>Substituído por: <ModuleLink className="text-link" href={documentationHref(document.replacementId)}>Abrir documento substituto</ModuleLink></p>}
        <p className="documentation-help">Boleto e comprovante são documentos separados. Anexá-los não altera a situação financeira da compra.</p>
      </section></div>
      <DocumentFiles files={document.files}/>
      <section className="documentation-section"><div className="documentation-context-heading"><h3>Boletos e documentos relacionados</h3>{query.data?.canManage && active && !document.parentId && <div className="documentation-actions"><button className="btn" type="button" onClick={() => setChildKind('boleto')}><Plus size={15}/>Adicionar boleto</button><button className="btn" type="button" onClick={() => setChildKind('payment')}><Plus size={15}/>Adicionar comprovante</button></div>}</div>{query.data && <DocumentTable documents={query.data.children}/>}</section>
      <section className="documentation-section"><h3>Histórico</h3><ol className="documentation-history">{query.data?.history.map(event => <li key={event.id}><strong>{event.action === 'created' ? 'Documento cadastrado' : event.action === 'updated' ? 'Dados atualizados; conferência reiniciada' : documentStatuses[event.action as DocumentStatus] || event.action}</strong><span>{event.actorName} · {new Date(event.at).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})}</span>{event.details.document.reviewNote && <p>{event.details.document.reviewNote}</p>}</li>)}</ol></section>
      {editing && <DocumentForm key={document.id} document={document} onClose={() => setEditing(false)} onSaved={() => setEditing(false)}/>}
      {reviewing && <ReviewForm document={document} onClose={() => setReviewing(false)}/>}
      {childKind && <DocumentForm parent={document} initialKind={childKind} onClose={() => setChildKind(null)} onSaved={newId => {setChildKind(null);navigate(documentationHref(newId));}}/>}
    </>}
  </section>;
}
