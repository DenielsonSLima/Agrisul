'use client';

import {useRef, useState, type FormEvent} from 'react';
import {History, Loader2, Save} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {CurrencyInput} from '@/shared/components/CurrencyInput';
import {Field} from '@/shared/components/Common';
import {moneyLabel} from '@/shared/utils/presentation';
import type {
  QuoteItem,
  QuoteNegotiation,
  QuoteNegotiationInput,
  QuoteProvider,
} from '../types';

type NegotiationDraft = Omit<QuoteNegotiationInput, 'id'>;

type QuotePriceDialogProps = {
  item: QuoteItem;
  provider: QuoteProvider;
  currentPrice: string;
  history: QuoteNegotiation[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: NegotiationDraft) => Promise<void>;
};

function timestampLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não informada';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function QuotePriceDialog({
  item,
  provider,
  currentPrice,
  history,
  saving,
  onClose,
  onSave,
}: QuotePriceDialogProps) {
  const [unitPrice, setUnitPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const requestRef = useRef<{fingerprint: string; requestId: string} | null>(null);
  const busy = saving || submitting;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || submittingRef.current) return;
    if (!unitPrice.trim()) {
      setValidationError('Informe o novo valor unitário.');
      return;
    }
    const normalizedNotes = notes.trim();
    const fingerprint = JSON.stringify({
      quotationProviderId: provider.id,
      quotationItemId: item.id,
      unitPrice: unitPrice.trim(),
      notes: normalizedNotes,
    });
    if (requestRef.current?.fingerprint !== fingerprint) {
      requestRef.current = {fingerprint, requestId: crypto.randomUUID()};
    }
    setValidationError('');
    setRequestError('');
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSave({
        requestId: requestRef.current.requestId,
        quotationProviderId: provider.id,
        quotationItemId: item.id,
        unitPrice,
        notes: normalizedNotes,
      });
      onClose();
    } catch (reason) {
      setRequestError((reason as Error).message || 'Não foi possível registrar o novo preço.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => {if (!open && !busy) onClose();}}>
      <DialogContent
        className="form-modal quote-price-dialog"
        showCloseButton={!busy}
        onEscapeKeyDown={event => {if (busy) event.preventDefault();}}
        onPointerDownOutside={event => {if (busy) event.preventDefault();}}
      >
        <DialogHeader>
          <DialogTitle>Novo preço</DialogTitle>
          <DialogDescription>
            Registre uma nova versão sem apagar os preços informados anteriormente.
          </DialogDescription>
        </DialogHeader>

        <div className="quote-price-context" aria-label="Contexto da negociação">
          <div><span>Material</span><strong>{item.materialName}</strong></div>
          <div><span>Fornecedor</span><strong>{provider.providerName}</strong></div>
          <div><span>Preço atual</span><strong>{currentPrice ? moneyLabel(currentPrice) : 'Não informado'}</strong></div>
        </div>

        <form className="quote-price-form" onSubmit={submit} aria-busy={busy}>
          <p className="quote-price-help">
            <History size={16}/>
            O novo valor será acrescentado ao histórico. Nenhuma versão anterior será apagada.
          </p>
          <fieldset disabled={busy}>
            <Field label="Novo valor unitário *">
              <CurrencyInput
                autoFocus
                value={unitPrice}
                onValueChange={value => {
                  setUnitPrice(value);
                  setValidationError('');
                  setRequestError('');
                }}
                aria-invalid={!!validationError}
                aria-describedby={validationError ? 'quote-price-validation-error' : undefined}
              />
            </Field>
            <Field label="Observação (opcional)">
              <textarea
                rows={3}
                maxLength={2000}
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Frete, prazo, desconto ou condição informada pelo fornecedor"
              />
            </Field>
          </fieldset>

          {validationError && (
            <p id="quote-price-validation-error" className="form-error" role="alert">
              {validationError}
            </p>
          )}
          {requestError && <p className="form-error" role="alert">{requestError}</p>}

          <section className="quote-price-dialog-history" aria-labelledby="quote-price-history-title">
            <header>
              <h3 id="quote-price-history-title">Histórico de preços</h3>
              <span>{history.length} vers{history.length === 1 ? 'ão registrada' : 'ões registradas'}</span>
            </header>
            {history.length ? (
              <div className="quote-history-list">
                {history.map(entry => (
                  <article className="quote-history-row" key={entry.id}>
                    <span className="quote-history-version">Versão {entry.version}</span>
                    <div className="quote-history-copy">
                      <strong><time dateTime={entry.createdAt}>{timestampLabel(entry.createdAt)}</time></strong>
                      <small>{entry.notes || 'Sem observação'}</small>
                    </div>
                    <strong>{moneyLabel(entry.unitPrice)}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <p className="quote-negotiation-history-empty">Nenhum preço anterior registrado.</p>
            )}
          </section>

          <footer className="form-actions">
            <button className="btn" type="button" disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button className="btn company-primary" type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>}
              {busy ? 'Salvando…' : 'Registrar novo preço'}
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
