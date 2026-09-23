'use client';

import {useMemo, useRef, useState} from 'react';
import {Loader2, PackagePlus, Plus, RefreshCw, Users} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {Field, LocalSearch} from '@/shared/components/Common';
import {providerDocument} from '@/modules/cadastro/prestadores/presentation';
import type {ServiceProvider} from '@/modules/cadastro/prestadores/types';
import type {Material, QuoteScopeItemInput, QuoteScopeProviderInput} from '../types';
import {QuoteMaterialPicker} from './QuoteMaterialPicker';

export type {QuoteScopeItemInput, QuoteScopeProviderInput} from '../types';

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

export function QuoteAddMaterialDialog({
  open,
  materials,
  existingMaterialIds,
  catalogLoading,
  catalogError,
  saving,
  onReloadCatalog,
  onClose,
  onSave,
}: {
  open: boolean;
  materials: Material[];
  existingMaterialIds: ReadonlySet<string>;
  catalogLoading: boolean;
  catalogError: string;
  saving: boolean;
  onReloadCatalog: () => Promise<void>;
  onClose: () => void;
  onSave: (item: QuoteScopeItemInput) => Promise<void>;
}) {
  const [materialId, setMaterialId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const retryItemId = useRef<string | null>(null);
  const available = useMemo(
    () => materials.filter(material => !existingMaterialIds.has(material.id)),
    [existingMaterialIds, materials],
  );
  const selected = available.find(material => material.id === materialId);

  const close = () => {
    if (saving) return;
    setMaterialId('');
    setQuantity('');
    setNotes('');
    setError('');
    retryItemId.current = null;
    onClose();
  };

  const submit = async () => {
    setError('');
    if (!materialId || !quantity.trim()) {
      setError('Selecione o material e informe a quantidade.');
      return;
    }
    try {
      retryItemId.current ??= crypto.randomUUID();
      await onSave({
        id: retryItemId.current,
        materialId,
        quantity: quantity.trim(),
        notes: notes.trim(),
      });
      close();
    } catch (reason) {
      setError((reason as Error).message || 'Não foi possível adicionar o material.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => {if (!next) close();}}>
      <DialogContent
        className="form-modal quote-scope-dialog"
        showCloseButton={!saving}
        onEscapeKeyDown={event => {if (saving) event.preventDefault();}}
        onPointerDownOutside={event => {if (saving) event.preventDefault();}}
      >
        <DialogHeader>
          <DialogTitle>Adicionar material</DialogTitle>
          <DialogDescription>
            Inclua um novo item sem perder os preços e o histórico já registrados.
          </DialogDescription>
        </DialogHeader>

        {catalogLoading ? (
          <div className="client-loading" role="status">
            <Loader2 className="animate-spin" size={18}/>Carregando materiais…
          </div>
        ) : catalogError && !materials.length ? (
          <div className="company-empty" role="alert">
            <PackagePlus size={24} aria-hidden="true"/>
            <h3>Não foi possível carregar os materiais</h3>
            <p>{catalogError}</p>
            <button className="btn" type="button" onClick={() => void onReloadCatalog()}>
              <RefreshCw size={15}/>Tentar novamente
            </button>
          </div>
        ) : available.length ? (
          <div className="quote-scope-form">
            <QuoteMaterialPicker
              materials={available}
              value={materialId}
              itemNumber={1}
              onChange={value => {
                setMaterialId(value);
                setError('');
              }}
            />
            <div className="quote-scope-fields">
              <Field label={`Quantidade${selected?.unit ? ` (${selected.unit})` : ''} *`}>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={quantity}
                  onChange={event => setQuantity(event.target.value)}
                />
              </Field>
              <Field label="Observação">
                <input
                  maxLength={500}
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  placeholder="Opcional"
                />
              </Field>
            </div>
          </div>
        ) : (
          <div className="company-empty">
            <PackagePlus size={24} aria-hidden="true"/>
            <h3>{materials.length ? 'Todos os materiais já foram incluídos' : 'Nenhum material cadastrado'}</h3>
            <p>{materials.length
              ? 'Cadastre outro material para ampliar esta cotação.'
              : 'Cadastre um material antes de incluí-lo na cotação.'}</p>
          </div>
        )}

        {catalogError && materials.length > 0 && (
          <p className="form-error" role="status">
            A lista pode estar desatualizada. {catalogError}{' '}
            <button className="btn-link" type="button" onClick={() => void onReloadCatalog()}>Recarregar</button>
          </p>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="form-actions">
          <button className="btn" type="button" disabled={saving} onClick={close}>Cancelar</button>
          <button
            className="btn company-primary"
            type="button"
            disabled={saving || catalogLoading || (!!catalogError && !materials.length) || !available.length}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="animate-spin" size={16}/> : <Plus size={16}/>} 
            {saving ? 'Adicionando…' : 'Adicionar material'}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export function QuoteAddProviderDialog({
  open,
  providers,
  existingProviderIds,
  catalogLoading,
  catalogError,
  saving,
  onReloadCatalog,
  onClose,
  onSave,
}: {
  open: boolean;
  providers: ServiceProvider[];
  existingProviderIds: ReadonlySet<string>;
  catalogLoading: boolean;
  catalogError: string;
  saving: boolean;
  onReloadCatalog: () => Promise<void>;
  onClose: () => void;
  onSave: (providers: QuoteScopeProviderInput[]) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const retryProviderIds = useRef(new Map<string, string>());
  const available = useMemo(
    () => providers.filter(provider => !existingProviderIds.has(provider.id)),
    [existingProviderIds, providers],
  );
  const searchValue = normalize(search);
  const documentDigits = search.replace(/\D/g, '');
  const filtered = available.filter(provider => {
    const searchable = normalize([
      provider.legalName,
      provider.tradeName,
      provider.document,
      providerDocument(provider),
    ].join(' '));
    return searchable.includes(searchValue)
      || (documentDigits.length > 2 && provider.document.includes(documentDigits));
  });

  const close = () => {
    if (saving) return;
    setSearch('');
    setSelectedIds([]);
    setError('');
    retryProviderIds.current.clear();
    onClose();
  };

  const submit = async () => {
    setError('');
    if (!selectedIds.length) {
      setError('Selecione ao menos um fornecedor.');
      return;
    }
    try {
      await onSave(selectedIds.map(providerId => {
        const existingId = retryProviderIds.current.get(providerId);
        const id = existingId ?? crypto.randomUUID();
        retryProviderIds.current.set(providerId, id);
        return {id, providerId, notes: '', sentAt: null};
      }));
      close();
    } catch (reason) {
      setError((reason as Error).message || 'Não foi possível adicionar os fornecedores.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => {if (!next) close();}}>
      <DialogContent
        className="form-modal quote-scope-dialog quote-provider-scope-dialog"
        showCloseButton={!saving}
        onEscapeKeyDown={event => {if (saving) event.preventDefault();}}
        onPointerDownOutside={event => {if (saving) event.preventDefault();}}
      >
        <DialogHeader>
          <DialogTitle>Adicionar fornecedores</DialogTitle>
          <DialogDescription>
            Os novos fornecedores receberão todos os itens atuais da cotação para negociação.
          </DialogDescription>
        </DialogHeader>

        {catalogLoading ? (
          <div className="client-loading" role="status">
            <Loader2 className="animate-spin" size={18}/>Carregando fornecedores…
          </div>
        ) : catalogError && !providers.length ? (
          <div className="company-empty" role="alert">
            <Users size={24} aria-hidden="true"/>
            <h3>Não foi possível carregar os fornecedores</h3>
            <p>{catalogError}</p>
            <button className="btn" type="button" onClick={() => void onReloadCatalog()}>
              <RefreshCw size={15}/>Tentar novamente
            </button>
          </div>
        ) : available.length ? (
          <>
            <LocalSearch
              value={search}
              onChange={setSearch}
              placeholder="Buscar por razão social, nome fantasia, CPF ou CNPJ"
            />
            <div className="quote-provider-table-wrap quote-scope-provider-list" role="region" aria-label="Fornecedores disponíveis" tabIndex={0}>
              <table className="quote-provider-table">
                <thead>
                  <tr><th scope="col">Selecionar</th><th scope="col">Fornecedor</th></tr>
                </thead>
                <tbody>
                  {filtered.map(provider => {
                    const checked = selectedIds.includes(provider.id);
                    const inputId = `quote-add-provider-${provider.id}`;
                    return (
                      <tr key={provider.id} className={checked ? 'selected' : ''}>
                        <td className="quote-provider-select-cell">
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedIds(current => checked
                                ? current.filter(id => id !== provider.id)
                                : [...current, provider.id]);
                              setError('');
                            }}
                            aria-label={`Selecionar ${provider.legalName}`}
                          />
                        </td>
                        <td>
                          <label className="quote-provider-copy" htmlFor={inputId}>
                            <strong className="quote-provider-name">{provider.legalName}</strong>
                            <span className="quote-provider-meta">
                              <span>{provider.documentType}: {providerDocument(provider)}</span>
                              <span aria-hidden="true">·</span>
                              <span>{provider.tradeName || 'Nome fantasia não informado'}</span>
                            </span>
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filtered.length && <div className="empty">Nenhum fornecedor encontrado.</div>}
            </div>
          </>
        ) : (
          <div className="company-empty">
            <Users size={24} aria-hidden="true"/>
            <h3>{providers.length ? 'Todos os fornecedores já foram incluídos' : 'Nenhum fornecedor cadastrado'}</h3>
            <p>{providers.length
              ? 'Cadastre um novo prestador para ampliar esta cotação.'
              : 'Cadastre um prestador antes de incluí-lo na cotação.'}</p>
          </div>
        )}

        {catalogError && providers.length > 0 && (
          <p className="form-error" role="status">
            A lista pode estar desatualizada. {catalogError}{' '}
            <button className="btn-link" type="button" onClick={() => void onReloadCatalog()}>Recarregar</button>
          </p>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="form-actions">
          <button className="btn" type="button" disabled={saving} onClick={close}>Cancelar</button>
          <button
            className="btn company-primary"
            type="button"
            disabled={saving || catalogLoading || (!!catalogError && !providers.length) || !available.length}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="animate-spin" size={16}/> : <Plus size={16}/>} 
            {saving ? 'Adicionando…' : `Adicionar ${selectedIds.length || ''}`.trim()}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
