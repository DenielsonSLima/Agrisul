'use client';
import {useState, type FormEvent} from 'react';
import {FolderOpen, Loader2, Plus} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {notifications, useConfirmation} from '@/shared/feedback';
import {dateLabel} from '@/shared/utils/presentation';
import {useDocumentContext, useDocumentMutations, useDocuments} from '../hooks/useDocumentation';
import {documentKinds, emptyDocumentFilters, type DocumentExpectation, type DocumentKind, type DocumentSource, type SourceReference} from '../types';
import {DocumentFiles, DocumentState, DocumentTable, useDocumentOperation} from './DocumentElements';
import {DocumentForm, SourcePicker} from './DocumentForm';
import '../styles.css';

export const sourceDocumentationHref = (source: SourceReference) => `/documentacao?tipo=${source.type}&origem=${encodeURIComponent(source.id)}`;
export function ExpectationForm({source, expectation, onClose}: {source?: DocumentSource; expectation?: DocumentExpectation; onClose: () => void}) {
  const [sources, setSources] = useState<DocumentSource[]>(source ? [source] : []);
  const [kind, setKind] = useState<DocumentKind>(expectation?.kind ?? 'invoice');
  const [required, setRequired] = useState(expectation?.required ?? true);
  const [dueOn, setDueOn] = useState(expectation?.dueOn ?? '');
  const [notes, setNotes] = useState(expectation?.notes ?? '');
  const [error, setError] = useState('');
  const {expectation: mutation} = useDocumentMutations();
  const execution = useDocumentOperation();
  const confirm = useConfirmation();
  const save = async (event: FormEvent) => {
    event.preventDefault();setError('');if (!sources.length || mutation.isPending) return;
    const operation = execution();
    if (expectation?.required && !required && !await confirm({title: 'Dispensar este documento?', description: 'O documento deixará de ser cobrado nesta referência. Os arquivos já cadastrados serão preservados.', confirmLabel: 'Dispensar documento'})) return;
    try {
      await mutation.mutateAsync({input: {source: {type: sources[0].type, id: sources[0].id}, kind, required, dueOn, notes}, execution: operation});
      if (!operation.signal.aborted) {notifications.saved(required ? 'Documento esperado registrado.' : 'Documento marcado como não exigido.');onClose();}
    } catch (reason) {if (!operation.signal.aborted) {const message = (reason as Error).message;setError(message);notifications.error(message);}}
  };
  return <Dialog open onOpenChange={open => {if (!open && !mutation.isPending) onClose();}}><DialogContent className="documentation-form-dialog"><DialogTitle>{expectation ? 'Alterar documento esperado' : 'Registrar documento esperado'}</DialogTitle><DialogDescription>A pendência pode ser criada antes de qualquer arquivo ser anexado. Só indique boleto quando ele for necessário.</DialogDescription>
    <form onSubmit={save}><fieldset disabled={mutation.isPending}>{source ? <p className="documentation-source-summary"><strong>{source.label}</strong> · {source.description}</p> : <SourcePicker selected={sources} onChange={value => setSources(value.slice(-1))}/>}
      <div className="documentation-form-grid"><label>Documento esperado<select value={kind} disabled={!!expectation} onChange={e => setKind(e.target.value as DocumentKind)}>{Object.entries(documentKinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Prazo para receber<input type="date" value={dueOn} onChange={e => setDueOn(e.target.value)}/></label></div>
      <label className="documentation-checkbox"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)}/>Este documento é esperado nesta compra ou serviço</label>
      <label>Observações<textarea rows={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex.: fornecedor ficou de enviar a nota até sexta-feira"/></label>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="documentation-form-actions"><button className="btn" type="button" disabled={mutation.isPending} onClick={onClose}>Cancelar</button><button className="btn company-primary" disabled={mutation.isPending || !sources.length} type="submit">{mutation.isPending && <Loader2 size={15} className="animate-spin"/>}Salvar</button></div></form>
  </DialogContent></Dialog>;
}

export function DocumentationPanel({source}: {source: SourceReference}) {
  const {user} = useAuth();
  return <DocumentContextPanel key={`${user?.id ?? 'anonymous'}:${source.type}:${source.id}`} source={source}/>;
}
function DocumentContextPanel({source}: {source: SourceReference}) {
  const query = useDocumentContext(source);
  const [adding, setAdding] = useState(false);
  const [expected, setExpected] = useState<DocumentExpectation | null | undefined>();
  const context = query.data;
  return <section className="documentation-context">
    <DocumentState loading={query.loading} error={query.error} retry={() => void query.reload()}/>
    {context && <>
      <div className="documentation-context-heading"><div><h3><FolderOpen size={21}/>{context.source.label}</h3><p>{context.source.description}</p></div><div className="documentation-actions"><ModuleLink className="btn" href={context.source.href}>Abrir referência</ModuleLink>{context.canManage && <><button type="button" className="btn" onClick={() => setExpected(null)}>Definir documento esperado</button><button className="btn company-primary" type="button" onClick={() => setAdding(true)}><Plus size={16}/>Adicionar documento</button></>}</div></div>
      <section className="documentation-section"><h3>Documentos esperados</h3><p>Marque o que precisa receber. A ausência de boleto só é cobrada quando ele é esperado.</p>
        {context.expectations.length ? <ul className="documentation-expectations">{context.expectations.map(item => <li key={item.id}><div><strong>{documentKinds[item.kind]}</strong><small>{item.required ? 'Esperado' : 'Não exigido'}{item.dueOn ? ` · Prazo: ${dateLabel(item.dueOn)}` : ''}{item.notes ? ` · ${item.notes}` : ''}</small></div>{context.canManage && <button className="btn" type="button" onClick={() => setExpected(item)}>Alterar</button>}</li>)}</ul> : <p>Nenhuma exigência documental definida para esta referência.</p>}
      </section>
      <section className="documentation-section"><h3>Documentos vinculados <span>{context.documents.length}</span></h3><DocumentTable documents={context.documents}/></section>
      {!!context.existingFiles.length && <DocumentFiles files={context.existingFiles} title="Orçamentos já anexados na origem"/>}
      {adding && <DocumentForm source={context.source} onClose={() => setAdding(false)} onSaved={() => setAdding(false)}/>}
      {expected !== undefined && <ExpectationForm source={context.source} expectation={expected ?? undefined} onClose={() => setExpected(undefined)}/>}
    </>}
  </section>;
}

export function ProviderDocumentationPanel({providerId}: {providerId: string}) {
  const query = useDocuments({...emptyDocumentFilters, providerId, includePending: false});
  return <section className="documentation-context"><div className="documentation-context-heading"><div><h3>Documentação do prestador</h3><p>Notas fiscais, boletos e comprovantes vinculados a este cadastro.</p></div><ModuleLink className="btn" href={`/documentacao?fornecedor=${encodeURIComponent(providerId)}`}>Abrir na central</ModuleLink></div><DocumentState loading={query.loading} error={query.error} retry={() => void query.reload()}/>{query.data && <DocumentTable documents={query.data.documents}/>}</section>;
}
