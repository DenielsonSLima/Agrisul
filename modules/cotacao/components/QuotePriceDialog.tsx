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
  QuoteOffer,
  QuoteProvider,
} from '../types';

type NegotiationDraft = Omit<QuoteNegotiationInput, 'id'>;

type QuotePriceDialogProps = {
  item: QuoteItem;
  provider: QuoteProvider;
  currentPrice: string;
  currentOffer?: QuoteOffer;
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

function discountLabel(type: QuoteOffer['discountType'], value: string, amount: string) {
  if (type === 'percentage') return `Desconto ${value.replace('.', ',')}% (${moneyLabel(amount)})`;
  if (type === 'amount') return `Desconto fixo ${moneyLabel(amount)}`;
  return 'Sem desconto';
}

export function QuotePriceDialog({
  item,
  provider,
  currentPrice,
  currentOffer,
  history,
  saving,
  onClose,
  onSave,
}: QuotePriceDialogProps) {
  const [unitPrice, setUnitPrice] = useState(currentOffer?.unitPrice ?? '');
  const [availableQuantity, setAvailableQuantity] = useState(currentOffer?.availableQuantity ?? '');
  const [discountType, setDiscountType] = useState<QuoteOffer['discountType']>(
    currentOffer?.discountType ?? 'none',
  );
  const [discountValue, setDiscountValue] = useState(
    currentOffer?.discountType === 'none' ? '' : currentOffer?.discountValue ?? '',
  );
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
      setValidationError('Informe o valor unitário bruto.');
      return;
    }
    const requestedQuantity = Number(item.quantity.replace(',', '.'));
    const normalizedAvailableQuantity = availableQuantity.trim().replace(',', '.');
    if (normalizedAvailableQuantity) {
      const quantity = Number(normalizedAvailableQuantity);
      if (
        !/^\d+(?:[.,]\d{1,3})?$/.test(availableQuantity.trim())
        || !Number.isFinite(quantity)
        || quantity < 0
        || quantity > requestedQuantity
      ) {
        setValidationError(`Informe uma quantidade disponível entre 0 e ${item.quantity} ${item.unit}.`);
        return;
      }
    }
    if (discountType !== 'none' && !discountValue.trim()) {
      setValidationError('Informe o valor do desconto.');
      return;
    }
    const normalizedNotes = notes.trim();
    const fingerprint = JSON.stringify({
      quotationProviderId: provider.id,
      quotationItemId: item.id,
      unitPrice: unitPrice.trim(),
      availableQuantity: availableQuantity.trim(),
      discountType,
      discountValue: discountType === 'none' ? '0' : discountValue.trim(),
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
        availableQuantity,
        discountType,
        discountValue: discountType === 'none' ? '0' : discountValue,
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
          <DialogTitle>Nova condição comercial</DialogTitle>
          <DialogDescription>
            Registre uma nova versão sem apagar os preços informados anteriormente.
          </DialogDescription>
        </DialogHeader>

        <div className="quote-price-context" aria-label="Contexto da negociação">
          <div><span>Material</span><strong>{item.materialName}</strong></div>
          <div><span>Fornecedor</span><strong>{provider.providerName}</strong></div>
          <div>
            <span>Oferta atual</span>
            <strong>{currentOffer ? moneyLabel(currentOffer.lineTotal) : currentPrice ? moneyLabel(currentPrice) : 'Não informada'}</strong>
          </div>
        </div>

        <form className="quote-price-form" onSubmit={submit} aria-busy={busy}>
          <p className="quote-price-help">
            <History size={16}/>
            O novo valor será acrescentado ao histórico. Nenhuma versão anterior será apagada.
          </p>
          <fieldset disabled={busy}>
            <Field label="Valor unitário bruto *">
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
            <div className="quote-price-quantity-grid">
              <Field label="Quantidade solicitada">
                <input
                  type="text"
                  value={`${item.quantity} ${item.unit}`.trim()}
                  readOnly
                  aria-label="Quantidade solicitada"
                />
              </Field>
              <Field label={`Quantidade disponível (máx. ${item.quantity} ${item.unit})`}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={availableQuantity}
                  onChange={event => {
                    setAvailableQuantity(event.target.value);
                    setValidationError('');
                    setRequestError('');
                  }}
                  placeholder={`Em branco = ${item.quantity}`}
                  aria-label="Quantidade disponível no fornecedor"
                  aria-invalid={!!validationError}
                  aria-describedby={validationError ? 'quote-price-validation-error' : 'quote-available-quantity-help'}
                />
              </Field>
            </div>
            <p id="quote-available-quantity-help" className="quote-price-availability-note">
              Aceita zero. Se ficar em branco, o fornecedor atende toda a quantidade solicitada.
            </p>
            <div className="quote-price-discount-grid">
              <Field label="Tipo de desconto">
                <select
                  value={discountType}
                  onChange={event => {
                    const value = event.target.value as QuoteOffer['discountType'];
                    setDiscountType(value);
                    if (value === 'none') setDiscountValue('');
                    setValidationError('');
                    setRequestError('');
                  }}
                >
                  <option value="none">Sem desconto</option>
                  <option value="percentage">Percentual sobre o item</option>
                  <option value="amount">Valor fixo sobre o item</option>
                </select>
              </Field>
              {discountType === 'percentage' ? (
                <Field label="Percentual do desconto *">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={discountValue}
                    onChange={event => {
                      setDiscountValue(event.target.value);
                      setValidationError('');
                      setRequestError('');
                    }}
                    placeholder="Ex.: 7"
                    aria-label="Percentual do desconto"
                  />
                </Field>
              ) : discountType === 'amount' ? (
                <Field label="Desconto total deste item *">
                  <CurrencyInput
                    value={discountValue}
                    onValueChange={value => {
                      setDiscountValue(value);
                      setValidationError('');
                      setRequestError('');
                    }}
                    aria-label="Valor fixo do desconto do item"
                  />
                </Field>
              ) : null}
            </div>
            {discountType !== 'none' && (
              <p className="quote-price-discount-note">
                O desconto é aplicado ao subtotal deste material, considerando a quantidade disponível informada.
              </p>
            )}
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
                      <small>
                        Disponível: {entry.availableQuantity ?? item.quantity} {item.unit}
                        {entry.notes ? ` · ${entry.notes}` : ' · Sem observação'}
                      </small>
                    </div>
                    <div className="quote-history-values">
                      <strong>{moneyLabel(entry.lineTotal)}</strong>
                      <small>{discountLabel(entry.discountType, entry.discountValue, entry.discountAmount)}</small>
                      <small>Bruto unitário: {moneyLabel(entry.unitPrice)}</small>
                    </div>
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
              {busy ? 'Salvando…' : 'Registrar condição'}
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
