'use client';
import {useEffect, useRef, useState} from 'react';
import {FileText, Loader2, Paperclip, Save, X} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {CurrencyInput} from '@/shared/components/CurrencyInput';
import {notifications, useConfirmation} from '@/shared/feedback';
import {useRequestComplementMutation} from '../hooks/useServiceRequests';
import {assertRequestActor, uploadRequestAttachment} from '../services/requestApi';
import type {RequestFile, ServiceRequest} from '../types';

export function RequestComplementForm({request, actorId, onClose, onCloseAutoFocus}: {request: ServiceRequest; actorId: string; onClose: () => void; onCloseAutoFocus?: (event: Event) => void}) {
  const [initial] = useState(() => ({details: request.currentDetails, previousId: request.complements.at(-1)?.id ?? null, attachmentCount: request.attachments.length}));
  const [operationId] = useState(() => crypto.randomUUID());
  const [serviceValue, setServiceValue] = useState(initial.details.serviceValue ?? '');
  const [returnDate, setReturnDate] = useState(initial.details.returnDate ?? '');
  const [files, setFiles] = useState<{key: string; file: File}[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null), mounted = useRef(true), submitting = useRef(false);
  const uploaded = useRef(new Map<string, RequestFile>());
  const mutation = useRequestComplementMutation(), confirm = useConfirmation();
  useEffect(() => {mounted.current = true;return () => {mounted.current = false;operation.current?.abort();};}, []);
  const dirty = serviceValue !== (initial.details.serviceValue ?? '') || returnDate !== (initial.details.returnDate ?? '') || files.length > 0;
  async function close() {
    if (submitting.current) return;
    if (dirty && !await confirm({title: 'Descartar complementação?', description: 'Os dados preenchidos ainda não foram salvos.', confirmLabel: 'Descartar alterações', tone: 'destructive'})) return;
    if (mounted.current) onClose();
  }
  function addFiles(selected: FileList | null) {
    if (!selected) return;
    const next = Array.from(selected);
    const message = initial.attachmentCount + files.length + next.length > 5 ? 'A solicitação aceita no máximo cinco arquivos de orçamento.'
      : next.some(file => !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) ? 'Use PDF, PNG ou JPEG.'
      : next.some(file => !file.size || file.size > 10 * 1024 * 1024) ? 'Cada arquivo deve ter conteúdo e até 10 MB.' : '';
    if (message) {setError(message);notifications.error(message);return;}
    setError('');setFiles(current => [...current, ...next.map(file => ({key: crypto.randomUUID(), file}))]);
  }
  return <Dialog open onOpenChange={open => {if (!open) void close();}}><DialogContent className="request-complement-modal" showCloseButton={!busy} onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={event => {if (busy) event.preventDefault();}} onPointerDownOutside={event => {if (busy) event.preventDefault();}}>
    <DialogHeader><DialogTitle>Complementar solicitação nº {request.number}</DialogTitle><DialogDescription>Informe o valor, a previsão de retorno e os arquivos do orçamento. Cada alteração registra seu usuário, data e hora.{request.status === 'approved' && ' A aprovação original será preservada.'}</DialogDescription></DialogHeader>
    <form className="request-complement-form" aria-busy={busy} onSubmit={async event => {
      event.preventDefault();if (submitting.current) return;submitting.current = true;setBusy(true);setError('');
      const controller = new AbortController();operation.current = controller;const execution = {actorId, signal: controller.signal};
      try {
        const attachmentIds: string[] = [];
        for (const entry of files) {
          await assertRequestActor(execution);
          let file = uploaded.current.get(entry.key);
          if (!file) {file = await uploadRequestAttachment(request.id, entry.file, execution);uploaded.current.set(entry.key, file);}
          attachmentIds.push(file.id);
        }
        await mutation.mutateAsync({input: {id: request.id, operationId, expectedComplementId: initial.previousId, serviceValue: serviceValue || null, returnDate: returnDate || null, attachmentIds}, execution});
        if (mounted.current) {notifications.updated('Os dados foram complementados e registrados no histórico.');onClose();}
      } catch (caught) {if (mounted.current && !controller.signal.aborted) {const message = caught instanceof Error ? caught.message : 'Não foi possível salvar os dados.';setError(message);notifications.error(message);}}
      finally {submitting.current = false;if (mounted.current) setBusy(false);}
    }}>
      <fieldset className="request-fieldset" disabled={busy}>
        <div className="request-form-grid"><label className="field"><span>Valor do serviço (opcional)</span><CurrencyInput value={serviceValue} onValueChange={setServiceValue}/></label><label className="field"><span>Previsão de retorno (opcional)</span><input type="date" value={returnDate} onChange={event => setReturnDate(event.target.value)}/></label></div>
        <label className="request-upload"><Paperclip size={23}/><strong>Anexar orçamento (opcional)</strong><span>PDF, PNG ou JPEG · até 10 MB por arquivo · {initial.attachmentCount} de 5 anexos já salvos</span><input type="file" accept="application/pdf,image/png,image/jpeg" multiple aria-label="Adicionar arquivos de orçamento" onChange={event => {addFiles(event.target.files);event.target.value = '';}}/></label>
        {!!files.length && <ul className="request-selected-files">{files.map(entry => <li key={entry.key}><FileText size={19}/><strong>{entry.file.name}</strong><button type="button" className="request-icon-button" aria-label={`Remover anexo ${entry.file.name}`} onClick={() => setFiles(current => current.filter(file => file.key !== entry.key))}><X size={17}/></button></li>)}</ul>}
      </fieldset>
      {error && <p className="request-inline-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={() => void close()}>Cancelar</button><button type="submit" className="btn company-primary" disabled={busy || !dirty}>{busy ? <Loader2 size={17} className="animate-spin"/> : <Save size={17}/>}Salvar complementação</button></div>
    </form>
  </DialogContent></Dialog>;
}
