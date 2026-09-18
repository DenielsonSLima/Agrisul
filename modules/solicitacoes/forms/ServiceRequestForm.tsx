'use client';
/* eslint-disable @next/next/no-img-element -- Private signed originals must bypass the public image optimizer. */
import {forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent} from 'react';
import {FileText, Loader2, Paperclip, PenLine, Plus, Send, Trash2, X} from 'lucide-react';
import {CurrencyInput} from '@/shared/components/CurrencyInput';
import {notifications, useConfirmation} from '@/shared/feedback';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {useRequestFileUrl} from '../hooks/useServiceRequests';
import {SigningModeChoice} from '../components/SigningModeChoice';
import {RequestProviderSelect} from '../components/RequestProviderSelect';
import {assertRequestActor, requestSignatureBucket, uploadRequestAttachment} from '../services/requestApi';
import type {RequestExecution, RequestFile, RequestInput, RequestItem, RequestOptions, RequestSigningMode, ServiceRequest} from '../types';

const acceptedFiles = ['application/pdf', 'image/png', 'image/jpeg'];
type DraftItem = RequestItem & {key: string};
const emptyItem = (): DraftItem => ({key: crypto.randomUUID(), description: '', application: ''});
type SelectedFile = {key: string; file: File};

export type ServiceRequestFormHandle = {requestClose: () => Promise<void>};
type Props = {
  options: RequestOptions;
  onSave: (input: RequestInput, execution: RequestExecution) => Promise<ServiceRequest>;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
};
export const ServiceRequestForm = forwardRef<ServiceRequestFormHandle, Props>(function ServiceRequestForm({options, onSave, onClose, onBusy}, ref) {
  const confirm = useConfirmation();
  const [requestId] = useState(() => crypto.randomUUID());
  const [requesterSignatureId, setRequesterSignatureId] = useState('');
  const [requesterSigningMode, setRequesterSigningMode] = useState<RequestSigningMode>('manual');
  const [providerId, setProviderId] = useState('');
  const [items, setItems] = useState<DraftItem[]>(() => [emptyItem()]);
  const [serviceValue, setServiceValue] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const uploaded = useRef(new Map<string, RequestFile>());
  const operation = useRef<AbortController | null>(null);
  const closing = useRef(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; operation.current?.abort();};}, []);
  const requesters = options.requesterSignatures ?? [];
  const selectedRequester = requesters.find(requester => requester.id === requesterSignatureId);
  const signature = useRequestFileUrl(requestSignatureBucket, requesterSigningMode === 'registered' ? selectedRequester?.filePath : null);
  const canFill = options.canCreate && requesters.length > 0;
  const canSubmit = canFill && !!selectedRequester && !!providerId;

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    const next = Array.from(selected);
    const validation = files.length + next.length > 5 ? 'Adicione no máximo cinco arquivos de orçamento.'
      : next.some(file => !acceptedFiles.includes(file.type)) ? 'Use arquivos PDF, PNG ou JPEG para o orçamento.'
      : next.some(file => file.size > 10 * 1024 * 1024 || !file.size) ? 'Cada arquivo deve ter conteúdo e até 10 MB.' : '';
    if (validation) {setError(validation); notifications.error(validation); return;}
    setError('');
    setFiles(current => [...current, ...next.map(file => ({key: crypto.randomUUID(), file}))]);
  }

  async function close() {
    if (submitting.current || closing.current) return;
    closing.current = true;
    const dirty = !!(requesterSignatureId || providerId || serviceValue || notes || returnDate || files.length || items.some(item => item.description || item.application));
    try {if ((!dirty || await confirm({title: 'Descartar esta solicitação?', description: 'Os dados deste formulário ainda não foram enviados para aprovação.', confirmLabel: 'Descartar formulário', tone: 'destructive'})) && mounted.current) onClose();}
    finally {closing.current = false;}
  }
  useImperativeHandle(ref, () => ({requestClose: close}));

  async function removeItem(key: string) {
    const item = items.find(row => row.key === key);
    if (!item || (item.description || item.application) && !await confirm({title: 'Remover este serviço?', description: 'A descrição e a aplicação deste item serão retiradas do formulário.', confirmLabel: 'Remover serviço', tone: 'destructive'})) return;
    setItems(current => current.filter(row => row.key !== key));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!selectedRequester) {setError('Selecione quem solicitou o serviço.'); return;}
    if (!providerId) {setError('Selecione o prestador que executará o serviço.'); return;}
    submitting.current = true;
    setBusy(true); onBusy(true); setError('');
    const controller = new AbortController(); operation.current = controller;
    const execution = {actorId: options.actorId, signal: controller.signal};
    try {
      const attachmentIds: string[] = [];
      for (const [index, entry] of files.entries()) {
        await assertRequestActor(execution);
        setProgress(`Enviando orçamento ${index + 1} de ${files.length}…`);
        let attachment = uploaded.current.get(entry.key);
        if (!attachment) {
          attachment = await uploadRequestAttachment(requestId, entry.file, execution);
          uploaded.current.set(entry.key, attachment);
        }
        attachmentIds.push(attachment.id);
      }
      setProgress('Registrando solicitação…');
      await assertRequestActor(execution);
      await onSave({requestId, requesterSignatureId, requesterSigningMode, providerId, items: items.map(({description, application}) => ({description, application})), serviceValue: serviceValue || null, returnDate: returnDate || null, notes, attachmentIds}, execution);
    } catch (caught) {
      if (controller.signal.aborted || caught instanceof DOMException && caught.name === 'AbortError') return;
      const message = caught instanceof Error ? caught.message : 'Não foi possível enviar a solicitação. Tente novamente.';
      setError(message); notifications.error(message);
    } finally {submitting.current = false; if (!controller.signal.aborted) {setBusy(false); onBusy(false); setProgress('');} if (operation.current === controller) operation.current = null;}
  }

  return <form className="request-form" onSubmit={event => void submit(event)} aria-busy={busy}>
    {!canFill && <div className="request-notice"><strong>{!options.canCreate ? 'Seu acesso permite consultar as solicitações.' : 'Cadastre um solicitante para continuar.'}</strong><p>Informe o nome da pessoa em Cadastros → Assinaturas. A imagem PNG é opcional. O solicitante não precisa de conta no sistema.</p><ModuleLink href="/cadastro?secao=assinaturas">Abrir cadastro de assinaturas</ModuleLink></div>}
    <fieldset disabled={busy || !canFill} className="request-fieldset">
      <section className="request-form-section"><div className="request-section-title"><span>01</span><div><h3>Quem solicitou o serviço?</h3><p>Selecione a pessoa para quem você está registrando a solicitação.</p></div></div>
        <label className="field"><span>Solicitante *</span><select className="request-person-select" autoFocus required value={requesterSignatureId} onChange={event => {const person = requesters.find(requester => requester.id === event.target.value); setRequesterSignatureId(event.target.value); setRequesterSigningMode(person?.filePath ? 'registered' : 'manual');}}><option value="" disabled>Selecione o solicitante</option>{requesters.map(requester => <option key={requester.id} value={requester.id}>{requester.name}</option>)}</select></label>
        <p className="field-help">Seu usuário ficará registrado como responsável pelo lançamento. A assinatura será da pessoa selecionada.</p>
        {selectedRequester && <SigningModeChoice name="requester-signing-mode" value={requesterSigningMode} hasImage={!!selectedRequester.filePath} onChange={setRequesterSigningMode}/>}
      </section>
      <section className="request-form-section"><div className="request-section-title"><span>02</span><div><h3>Prestador do serviço</h3><p>Selecione a pessoa ou empresa que executará o serviço. Os dados vêm do cadastro do prestador.</p></div></div>
        <RequestProviderSelect value={providerId} onChange={setProviderId} disabled={busy}/>
      </section>
      <section className="request-form-section"><div className="request-section-title"><span>03</span><div><h3>Equipamento, material e aplicação</h3><p>Inclua um item para cada serviço necessário.</p></div></div>
        <div className="request-item-editor">{items.map((item, index) => <div className="request-edit-item" key={item.key}><div className="request-edit-item-title"><strong>Serviço {index + 1}</strong>{items.length > 1 && <button type="button" className="request-icon-button" aria-label={`Remover serviço ${index + 1}`} onClick={() => void removeItem(item.key)}><Trash2 size={16}/></button>}</div><div className="request-form-grid"><label className="field"><span>Descrição do equipamento / material *</span><textarea required rows={3} maxLength={2000} value={item.description} onChange={event => setItems(current => current.map(row => row.key === item.key ? {...row, description: event.target.value} : row))} placeholder="Ex.: Confeccionar 2 mangueiras hidráulicas de pressão do comando"/></label><label className="field"><span>Aplicação *</span><textarea required rows={3} maxLength={1000} value={item.application} onChange={event => setItems(current => current.map(row => row.key === item.key ? {...row, application: event.target.value} : row))} placeholder="Ex.: Carregadeira Valtra BM100 nº 220/221"/></label></div></div>)}</div>
        <button type="button" className="btn request-add-item" disabled={items.length >= 50} onClick={() => setItems(current => [...current, emptyItem()])}><Plus size={16}/>Adicionar serviço</button>
      </section>
      <section className="request-form-section"><div className="request-section-title"><span>04</span><div><h3>Valor e orçamento (opcionais)</h3><p>Preencha agora, se já souber. Você também pode informar o valor, a previsão de retorno e os anexos após a aprovação do diretor.</p></div></div>
        <div className="request-form-grid"><label className="field"><span>Valor do serviço (opcional)</span><CurrencyInput value={serviceValue} onValueChange={setServiceValue}/></label><label className="field"><span>Previsão de retorno (opcional)</span><input type="date" value={returnDate} onChange={event => setReturnDate(event.target.value)}/></label></div>
        <label className="request-upload"><Paperclip size={23}/><strong>Anexar orçamento (opcional)</strong><span>PDF, PNG ou JPEG · até 10 MB por arquivo · máximo de 5</span><input type="file" accept="application/pdf,image/png,image/jpeg" multiple aria-label="Adicionar arquivos de orçamento" onChange={event => {addFiles(event.target.files); event.target.value = '';}}/></label>
        {files.length > 0 && <ul className="request-selected-files">{files.map(entry => <li key={entry.key}><FileText size={19}/><div><strong>{entry.file.name}</strong><small>{new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1}).format(entry.file.size / 1024)} KB</small></div><button type="button" className="request-icon-button" aria-label={`Remover anexo ${entry.file.name}`} onClick={() => setFiles(current => current.filter(file => file.key !== entry.key))}><X size={17}/></button></li>)}</ul>}
        <label className="field"><span>Observações</span><textarea rows={3} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Condições, orientações e informações complementares"/></label>
      </section>
    </fieldset>
    <section className="request-signing-note"><div><span className="eyebrow">SOLICITANTE</span><strong>{selectedRequester?.name || 'Selecione quem solicitou o serviço'}</strong><p>{requesterSigningMode === 'registered' ? 'O documento incluirá a imagem da assinatura cadastrada.' : 'O documento terá um espaço em branco para assinatura manual após a impressão.'} O histórico identificará você como responsável pelo lançamento.</p></div>{selectedRequester && requesterSigningMode === 'manual' ? <div className="request-manual-preview"><PenLine size={19}/><span>Assinatura manual</span></div> : signature.data && <img src={signature.data} alt={`Assinatura de ${selectedRequester?.name}`} width={160} height={64}/>}</section>
    {error && <p className="request-inline-error" role="alert">{error}</p>}
    <div className="request-form-actions"><span role="status">{busy ? progress : 'A solicitação será encaminhada à fila de pendentes.'}</span><div><button className="btn" type="button" disabled={busy} onClick={() => void close()}>Cancelar</button><button className="btn company-primary" type="submit" disabled={busy || !canSubmit}>{busy ? <Loader2 className="animate-spin" size={17}/> : <Send size={17}/>}Enviar solicitação</button></div></div>
  </form>;
});
