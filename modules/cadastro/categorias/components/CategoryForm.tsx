'use client';

import {useState, type FormEvent} from 'react';
import {Loader2, Save} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import type {MaterialCategory, MaterialCategoryInput} from '../types';
import '../styles.css';

export function CategoryForm({
  category,
  onClose,
  onSave,
}: {
  category?: MaterialCategory;
  onClose: () => void;
  onSave: (input: MaterialCategoryInput) => Promise<MaterialCategory>;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const normalizedName = name.trim();
    if (normalizedName.length < 2) {
      setError('Informe um nome com pelo menos 2 caracteres.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave({id: category?.id, name: normalizedName});
    } catch (reason) {
      const message = (reason as Error).message || 'Não foi possível salvar a categoria.';
      setError(message);
      notifications.error(message);
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => {if (!open && !saving) onClose();}}>
      <DialogContent
        className="form-modal category-modal"
        showCloseButton={!saving}
        onEscapeKeyDown={event => {if (saving) event.preventDefault();}}
        onPointerDownOutside={event => {if (saving) event.preventDefault();}}
      >
        <DialogHeader>
          <DialogTitle>{category ? 'Editar categoria' : 'Cadastrar categoria'}</DialogTitle>
          <DialogDescription>
            Informe o nome que será usado para agrupar os materiais.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={event => void submit(event)}>
          <fieldset disabled={saving}>
            <Field label="Nome da categoria *">
              <input
                autoFocus
                value={name}
                minLength={2}
                maxLength={100}
                required
                placeholder="Ex.: Filtros"
                onChange={event => {
                  setName(event.target.value);
                  setError('');
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'category-form-error' : undefined}
              />
            </Field>
          </fieldset>
          {error && <p id="category-form-error" className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" disabled={saving} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn company-primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>} 
              {saving ? 'Salvando…' : category ? 'Salvar alterações' : 'Cadastrar categoria'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
