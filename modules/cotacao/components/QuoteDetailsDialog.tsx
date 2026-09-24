'use client';

import {useRef, useState} from 'react';
import {Loader2, RefreshCw, Save} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {Signature} from '@/modules/cadastro/assinaturas/types';
import {Field} from '@/shared/components/Common';
import type {Quote, QuoteDetailsInput} from '../types';

export function QuoteDetailsDialog({
  quote,
  requesters,
  loading,
  loadError,
  saving,
  onReload,
  onClose,
  onSave,
}: {
  quote: Quote;
  requesters: Signature[];
  loading: boolean;
  loadError: string;
  saving: boolean;
  onReload: () => Promise<void>;
  onClose: () => void;
  onSave: (input: QuoteDetailsInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(quote.title);
  const [requestDate, setRequestDate] = useState(quote.requestDate);
  const [requesterSignatureId, setRequesterSignatureId] = useState(
    quote.requesterSignatureId ?? '',
  );
  const [notes, setNotes] = useState(quote.notes);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const requesterAvailable = requesters.some(requester => requester.id === requesterSignatureId);
  const currentRequesterMissing = !!quote.requesterSignatureId && !requesterAvailable;

  const close = () => {
    if (!saving && !submittingRef.current) onClose();
  };

  const submit = async () => {
    if (saving || submittingRef.current) return;
    setError('');
    if (!title.trim() || !requestDate || !requesterSignatureId || !requesterAvailable) {
      setError('Informe o título, a data e selecione um solicitante ativo.');
      return;
    }
    submittingRef.current = true;
    try {
      await onSave({
        id: quote.id,
        title: title.trim(),
        requestDate,
        requesterSignatureId,
        notes: notes.trim(),
      });
    } catch (reason) {
      setError((reason as Error).message || 'Não foi possível atualizar os dados da cotação.');
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Dialog open onOpenChange={open => {if (!open) close();}}>
      <DialogContent
        className="form-modal quote-details-dialog"
        showCloseButton={!saving}
        onEscapeKeyDown={event => {if (saving) event.preventDefault();}}
        onPointerDownOutside={event => {if (saving) event.preventDefault();}}
      >
        <DialogHeader>
          <DialogTitle>Editar dados da cotação</DialogTitle>
          <DialogDescription>
            Atualize o cabeçalho sem alterar materiais, fornecedores, preços ou histórico.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="quote-details-form" disabled={saving}>
          <Field label="Título *">
            <input
              autoFocus
              maxLength={150}
              value={title}
              onChange={event => setTitle(event.target.value)}
            />
          </Field>
          <div className="quote-details-grid">
            <Field label="Data da cotação *">
              <input
                type="date"
                value={requestDate}
                onChange={event => setRequestDate(event.target.value)}
              />
            </Field>
            <Field label="Solicitante *">
              <select
                value={requesterSignatureId}
                disabled={saving || loading}
                onChange={event => setRequesterSignatureId(event.target.value)}
              >
                <option value="">Selecione um solicitante</option>
                {currentRequesterMissing && (
                  <option value={quote.requesterSignatureId!} disabled>
                    {quote.requester} (inativo)
                  </option>
                )}
                {requesters.map(requester => (
                  <option key={requester.id} value={requester.id}>{requester.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Observações gerais">
            <textarea
              rows={5}
              maxLength={4000}
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Prazo, condição de entrega ou orientações"
            />
          </Field>
        </fieldset>

        {loading && (
          <p className="quote-details-status" role="status">
            <Loader2 className="animate-spin" size={15}/>Carregando solicitantes…
          </p>
        )}
        {loadError && (
          <p className="form-error" role="alert">
            {loadError}{' '}
            <button className="btn-link" type="button" disabled={saving} onClick={() => void onReload()}>
              <RefreshCw size={13}/>Tentar novamente
            </button>
          </p>
        )}
        {!loading && !loadError && !requesters.length && (
          <p className="form-error" role="alert">
            Nenhum solicitante ativo foi encontrado. Cadastre um solicitante em Assinaturas.
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}

        <footer className="form-actions">
          <button className="btn" type="button" disabled={saving} onClick={close}>Cancelar</button>
          <button
            className="btn company-primary"
            type="button"
            disabled={saving || loading || !!loadError || !requesters.length || !requesterAvailable}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>}
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
