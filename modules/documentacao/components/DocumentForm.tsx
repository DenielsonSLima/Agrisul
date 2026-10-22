'use client';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {FileUp, Loader2, Plus, X} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {CurrencyInput} from '@/shared/components/CurrencyInput';
import {notifications} from '@/shared/feedback';
import {useDocumentMutations, useDocumentOptions, useDocumentSources, useDocuments} from '../hooks/useDocumentation';
import {uploadDocumentFile} from '../services/documentationApi';
import {documentKinds, emptyDocumentFilters, type BillingDocument, type DocumentFile, type DocumentInput, type DocumentKind, type DocumentSource} from '../types';
import {DocumentState, useDocumentOperation} from './DocumentElements';

export function SourcePicker({selected, onChange}: {selected: DocumentSource[]; onChange: (sources: DocumentSource[]) => void}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState('');
  useEffect(() => {const timer = setTimeout(() => setDebounced(search), 250); return () => clearTimeout(timer);}, [search]);
  const query = useDocumentSources(debounced, type);
  return <div className="documentation-source-picker">
    <div className="documentation-form-grid"><label>Tipo de referência<select aria-label="Tipo de referência" value={type} onChange={e => setType(e.target.value)}><option value="">Todos</option><option value="service">Serviço</option><option value="quotation">Cotação</option><option value="order">Pedido de compra</option></select></label><label>Buscar referência<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Número, fornecedor, OC ou descrição" maxLength={200}/></label></div>
    {!!selected.length && <ul className="documentation-selected-sources">{selected.map(source => <li key={`${source.type}:${source.id}`}><span><strong>{source.label}</strong> {source.description}</span><button className="btn" type="button" aria-label={`Remover vínculo ${source.label}`} onClick={() => onChange(selected.filter(item => item.type !== source.type || item.id !== source.id))}><X size={15}/></button></li>)}</ul>}
    <DocumentState loading={query.loading} error={query.error} retry={() => void query.reload()}/>
    <div className="documentation-source-results">{query.data?.sources.filter(source => !selected.some(item => item.type === source.type && item.id === source.id)).map(source => <button className="documentation-source-option" type="button" key={`${source.type}:${source.id}`} onClick={() => onChange([...selected, source])} disabled={selected.length >= 20}><span><strong>{source.label}</strong><small>{source.description}</small></span><Plus size={16}/></button>)}</div>
    {query.data && !query.data.sources.length && <p>Nenhuma referência encontrada. Você também pode salvar sem vínculo e identificar depois.</p>}
  </div>;
}

function ParentPicker({value, onChange, currentId}: {value: BillingDocument | null; onChange: (document: BillingDocument | null) => void; currentId: string}) {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {const timer = setTimeout(() => setTerm(search), 250); return () => clearTimeout(timer);}, [search]);
  const query = useDocuments({...emptyDocumentFilters, search: term, includePending: false});
  return <div className="documentation-parent-picker"><label>Relacionar a uma nota ou documento principal (opcional)<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar documento principal" maxLength={200}/></label>
    {value ? <div className="documentation-selected-parent"><strong>{value.title}</strong><button className="btn" type="button" onClick={() => onChange(null)}>Desvincular</button></div> : <div className="documentation-source-results">{query.data?.documents.filter(document => document.id !== currentId && !document.parentId && !['cancelled', 'replaced'].includes(document.status)).slice(0, 6).map(document => <button className="documentation-source-option" type="button" key={document.id} onClick={() => onChange(document)}><span><strong>{document.title}</strong><small>{document.providerName || 'Sem fornecedor'} · {document.documentNumber || 'Sem número'}</small></span><Plus size={15}/></button>)}</div>}
    <DocumentState error={query.error} retry={() => void query.reload()}/>
  </div>;
}

export function DocumentForm({document, source, parent, initialKind, onClose, onSaved}: {document?: BillingDocument; source?: DocumentSource; parent?: BillingDocument; initialKind?: DocumentKind; onClose: () => void; onSaved: (id: string) => void}) {
  const options = useDocumentOptions();
  const mutations = useDocumentMutations();
  const execution = useDocumentOperation();
  const [form, setForm] = useState<DocumentInput>(() => ({
    id: document?.id ?? crypto.randomUUID(), expectedRevision: document?.revision ?? 0, kind: document?.kind ?? initialKind ?? 'invoice', title: document?.title ?? '', documentNumber: document?.documentNumber ?? '',
    issuedOn: document?.issuedOn ?? '', dueOn: document?.dueOn ?? '', amount: document?.amount ?? '', providerId: document?.providerId ?? parent?.providerId ?? source?.providerId ?? '', companyId: document?.companyId ?? parent?.companyId ?? '',
    parentId: document?.parentId ?? parent?.id ?? '', notes: document?.notes ?? '', sources: (document?.sources ?? (source ? [source] : parent?.sources ?? [])).map(({type, id}) => ({type, id})), fileIds: document?.files.map(file => file.id) ?? [],
  }));
  const [sources, setSources] = useState<DocumentSource[]>(() => document?.sources ?? (source ? [source] : parent?.sources ?? []));
  const [selectedParent, setSelectedParent] = useState<BillingDocument | null>(parent ?? null);
  const [choosingParent, setChoosingParent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const uploaded = useRef(new Map<File, DocumentFile>());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const set = <K extends keyof DocumentInput>(key: K, value: DocumentInput[K]) => setForm(current => ({...current, [key]: value}));
  const changeSources = (next: DocumentSource[]) => {
    setSources(next);
    const provider = next.find(item => item.providerId)?.providerId;
    setForm(current => ({...current, sources: next.map(({type, id}) => ({type, id})), providerId: provider ?? current.providerId}));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setError(''); setBusy(true);
    const operation = execution();
    try {
      const fileIds = [...(document?.files.map(file => file.id) ?? [])];
      for (const [index, file] of files.entries()) {
        setProgress(`Enviando arquivo ${index + 1} de ${files.length}…`);
        let stored = uploaded.current.get(file);
        if (!stored) {stored = await uploadDocumentFile(form.id, file, operation); uploaded.current.set(file, stored);}
        fileIds.push(stored.id);
      }
      setProgress('Salvando documento…');
      const result = await mutations.save.mutateAsync({input: {...form, fileIds}, execution: operation});
      if (operation.signal.aborted) return;
      if (document) notifications.updated('Documento atualizado. A conferência deve ser refeita.');
      else notifications.created('Documento e arquivos cadastrados.');
      onSaved(result.document.id);
    } catch (reason) {
      if (operation.signal.aborted) return;
      const message = reason instanceof Error ? reason.message : 'Não foi possível salvar o documento.';
      setError(message); notifications.error(message);
    } finally {if (!operation.signal.aborted) {setBusy(false); setProgress('');}}
  };
  return <Dialog open onOpenChange={open => {if (!open && !busy) onClose();}}><DialogContent className="documentation-form-dialog" onEscapeKeyDown={event => {if (busy) event.preventDefault();}} onInteractOutside={event => {if (busy) event.preventDefault();}}>
    <DialogTitle>{document ? 'Editar documento' : 'Adicionar documento'}</DialogTitle><DialogDescription>Guarde os arquivos e relacione-os à compra ou ao serviço. Boleto é opcional.</DialogDescription>
    <form onSubmit={save}><fieldset disabled={busy || options.loading || !!options.error}>
      <div className="documentation-form-grid"><label>Tipo de documento<select value={form.kind} onChange={e => set('kind', e.target.value as DocumentKind)}>{Object.entries(documentKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Número do documento<input value={form.documentNumber} onChange={e => set('documentNumber', e.target.value)} maxLength={100} placeholder="Opcional"/></label></div>
      <label>Título *<input required minLength={2} maxLength={200} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Ex.: Nota fiscal do conserto do trator 10"/></label>
      <div className="documentation-form-grid"><label>Fornecedor / prestador<select value={form.providerId} onChange={e => set('providerId', e.target.value)} disabled={sources.some(item => !!item.providerId)}><option value="">Não informado</option>{options.data?.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name} · {provider.document}</option>)}</select></label><label>Empresa destinatária<select value={form.companyId} onChange={e => set('companyId', e.target.value)}><option value="">Não informada</option>{options.data?.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label></div>
      <div className="documentation-form-grid three"><label>Emissão<input type="date" value={form.issuedOn} onChange={e => set('issuedOn', e.target.value)}/></label><label>Vencimento<input type="date" value={form.dueOn} onChange={e => set('dueOn', e.target.value)}/></label><label>Valor<CurrencyInput value={form.amount} onValueChange={value => set('amount', value)} placeholder="Opcional"/></label></div>
      <label>Observações<textarea maxLength={4000} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Equipamento, aplicação ou outras informações para localizar depois"/></label>
      <section className="documentation-form-section"><h3>Referências</h3><p>Selecione um ou mais registros. Sem vínculo, o documento ficará aguardando identificação.</p><SourcePicker selected={sources} onChange={changeSources}/></section>
      <section className="documentation-form-section"><h3>Documento principal</h3>{form.parentId && !choosingParent ? <p>{selectedParent?.title ?? document?.parentTitle ?? 'Documento relacionado'} <button type="button" className="btn" onClick={() => {set('parentId', ''); setSelectedParent(null);}}>Desvincular</button></p> : !choosingParent ? <button className="btn" type="button" onClick={() => setChoosingParent(true)}>Relacionar a uma nota / documento</button> : <ParentPicker value={selectedParent} currentId={form.id} onChange={value => {setSelectedParent(value);setForm(current => ({...current, parentId: value?.id ?? '', providerId: value?.providerId ?? current.providerId, companyId: value?.companyId ?? current.companyId})); if (value && !sources.length) changeSources(value.sources);}}/>}</section>
      <section className="documentation-form-section"><h3><FileUp size={18}/>Arquivos</h3><p>PDF, JPG, PNG, WebP ou XML. Até 10 MB por arquivo e 30 arquivos por documento.</p>
        {!!document?.files.length && <ul>{document.files.map(file => <li key={file.id}>{file.fileName} <small>Arquivo preservado</small></li>)}</ul>}
        <label className="documentation-upload">Selecionar arquivos<input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,application/xml,text/xml,.xml" onChange={event => {const additions = Array.from(event.target.files ?? []);setFiles(current => [...current, ...additions]); event.target.value = '';}}/></label>
        {!!files.length && <ul className="documentation-staged-files">{files.map((file, index) => <li key={`${file.name}:${index}`}><span>{file.name}</span><button className="btn" type="button" aria-label={`Remover ${file.name}`} onClick={() => setFiles(current => current.filter((_, position) => position !== index))}><X size={14}/></button></li>)}</ul>}
      </section>
    </fieldset><DocumentState error={options.error} retry={() => void options.reload()}/>{error && <p className="form-error" role="alert">{error}</p>}
    <div className="documentation-form-actions"><span aria-live="polite">{progress}</span><button className="btn" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn company-primary" type="submit" disabled={busy || options.loading || !!options.error || (!document && !files.length)}>{busy && <Loader2 size={16} className="animate-spin"/>}{busy ? 'Salvando…' : document ? 'Salvar alterações' : 'Cadastrar documento'}</button></div></form>
  </DialogContent></Dialog>;
}
