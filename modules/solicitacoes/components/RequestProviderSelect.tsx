'use client';
import {useId, useRef, useState} from 'react';
import {Loader2, Plus} from 'lucide-react';
import {Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty} from '@/components/ui/combobox';
import {useProviders} from '@/modules/cadastro/prestadores/hooks/useProviders';
import {ProviderForm} from '@/modules/cadastro/prestadores/forms/ProviderForm';
import {providerDocument} from '@/modules/cadastro/prestadores/presentation';
import {normalize} from '@/shared/utils/format';
import type {ServiceProvider} from '@/modules/cadastro/prestadores/types';
import '@/modules/cadastro/prestadores/styles.css';
import '../provider-select.css';

function matchesProvider(provider: ServiceProvider, search: string) {
  const query = normalize(search.trim()), documentQuery = search.replace(/[./\s-]/g, '').toUpperCase();
  return !query || normalize([provider.legalName, provider.tradeName].join(' ')).includes(query)
    || !!documentQuery && provider.document.toUpperCase().includes(documentQuery);
}

export function RequestProviderSelect({value, onChange, disabled}: {value: string; onChange: (id: string) => void; disabled: boolean}) {
  const model = useProviders(), [creating, setCreating] = useState(false), [search, setSearch] = useState<string | null>(null);
  const inputId = useId(), container = useRef<HTMLDivElement>(null), anchor = useRef<HTMLDivElement>(null);
  const providers = model.data?.providers ?? [], selected = providers.find(provider => provider.id === value);
  const filtered = search === null ? providers : providers.filter(provider => matchesProvider(provider, search));
  return <>
    {model.loading ? <p className="field-help" role="status"><Loader2 size={15} className="animate-spin"/>Carregando prestadores…</p> : model.error ? <p className="request-inline-error" role="alert">{model.error} <button type="button" className="request-text-button" onClick={() => void model.reload()}>Tentar novamente</button></p> : <>
      <div className="field request-provider-field" ref={container}>
        <label htmlFor={inputId}>Prestador *</label>
        <Combobox items={providers} filteredItems={filtered} value={selected ?? null} inputValue={search ?? selected?.legalName ?? ''} disabled={disabled} autoHighlight openOnInputClick
          itemToStringLabel={provider => provider.legalName} itemToStringValue={provider => provider.id}
          isItemEqualToValue={(a, b) => a.id === b.id} filter={null}
          onOpenChange={open => {if (!open) setSearch(null);}}
          onValueChange={provider => {onChange(provider?.id ?? '');setSearch(null);}}
          onInputValueChange={(text, event) => {if (event.reason === 'input-change') {setSearch(text);if (value) onChange('');}}}>
          <div ref={anchor}><ComboboxInput id={inputId} className="request-provider-combobox" disabled={disabled} placeholder="Selecione ou busque por nome, CPF ou CNPJ" aria-required="true" autoComplete="off"/></div>
          <ComboboxContent anchor={anchor} portalContainer={container} className="request-provider-options">
            <ComboboxEmpty>{providers.length ? 'Nenhum prestador encontrado para esta busca.' : 'Nenhum prestador cadastrado.'}</ComboboxEmpty>
            <ComboboxList>{(provider: ServiceProvider) => <ComboboxItem key={provider.id} value={provider} data-provider-id={provider.id} className="request-provider-option"><span><strong>{provider.legalName}</strong><small>{provider.documentType}: {providerDocument(provider)}{provider.tradeName && provider.tradeName !== provider.legalName ? ` · ${provider.tradeName}` : ''}</small></span></ComboboxItem>}</ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
      {!providers.length && <p className="field-help">Nenhum prestador cadastrado.{!model.data?.canManage && ' Peça o cadastro a alguém com permissão para alterar Cadastros.'}</p>}
      {selected && <div className="request-provider-summary"><strong>{selected.legalName}</strong><span>{selected.documentType}: {providerDocument(selected)}</span><p>{selected.address || 'Endereço não informado no cadastro.'}</p><p>{[selected.phone, selected.email].filter(Boolean).join(' · ')}</p></div>}
      {model.data?.canManage && <div className="request-provider-actions"><button type="button" className="btn small" disabled={disabled} onClick={() => setCreating(true)}><Plus size={15}/>Cadastrar prestador</button></div>}
    </>}
    {creating && <ProviderForm onClose={() => setCreating(false)} onSaved={provider => {onChange(provider.id);setSearch(null);setCreating(false);}}/>}
  </>;
}
