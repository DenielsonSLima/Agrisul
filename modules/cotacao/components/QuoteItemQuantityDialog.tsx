'use client';

import {type FormEvent, useRef, useState} from 'react';
import {Loader2, Save} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import type {QuoteItem} from '../types';

export function QuoteItemQuantityDialog({
  item,
  saving,
  onClose,
  onSave,
}: {
  item: QuoteItem;
  saving: boolean;
  onClose: () => void;
  onSave: (quantity: string) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState(item.quantity);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || submitting.current) return;
    const normalized = quantity.trim().replace(',', '.');
    const value = Number(normalized);
    if (!normalized || !Number.isFinite(value) || value <= 0 || !/^\d+(?:[.,]\d{1,3})?$/.test(quantity.trim())) {
      setError('Informe uma quantidade positiva com até três casas decimais.');
      return;
    }
    submitting.current = true;
    setError('');
    try {
      await onSave(quantity.trim());
    } catch (reason) {
      setError((reason as Error).message || 'Não foi possível alterar a quantidade.');
    } finally {
      submitting.current = false;
    }
  };

  return (
    <Dialog open onOpenChange={open => {if (!open && !saving) onClose();}}>
      <DialogContent
        className="quote-quantity-modal"
        showCloseButton={!saving}
        onEscapeKeyDown={event => {if (saving) event.preventDefault();}}
        onPointerDownOutside={event => {if (saving) event.preventDefault();}}
      >
        <DialogHeader>
          <DialogTitle>Alterar quantidade</DialogTitle>
          <DialogDescription>
            Os subtotais, descontos e valores aprovados serão recalculados com a nova quantidade.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={event => void submit(event)}>
          <div className="quote-quantity-context">
            <strong>{item.materialName}</strong>
            <small>Unidade: {item.unit}</small>
          </div>
          <Field label={`Quantidade (${item.unit}) *`}>
            <input
              autoFocus
              required
              inputMode="decimal"
              value={quantity}
              onChange={event => setQuantity(event.target.value)}
              aria-invalid={!!error}
            />
          </Field>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="btn" type="button" disabled={saving} onClick={onClose}>Cancelar</button>
            <button className="btn company-primary" type="submit" disabled={saving || quantity.trim() === item.quantity}>
              {saving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>}
              {saving ? 'Salvando…' : 'Salvar quantidade'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
