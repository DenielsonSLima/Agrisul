'use client';
/* Product photos are private signed assets rendered as decorative thumbnails. */
/* eslint-disable @next/next/no-img-element */

import {useId, useMemo, useRef, useState} from 'react';
import {PackageOpen} from 'lucide-react';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';
import {normalize} from '@/shared/utils/format';
import type {Material} from '../types';

function referenceLabel(material: Material) {
  return material.references
    .map(reference => [reference.brand, reference.code].filter(Boolean).join(' '))
    .join(' · ');
}

function searchableMaterial(material: Material) {
  return normalize([
    material.name,
    material.application,
    material.internalCode,
    referenceLabel(material),
  ].join(' '));
}

export function MaterialThumbnail({material}: {material: Material}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageAvailable = material.imageUrl && failedUrl !== material.imageUrl;

  return (
    <span className="quote-material-thumbnail" aria-hidden="true">
      {imageAvailable ? (
        <img
          src={material.imageUrl!}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(material.imageUrl)}
        />
      ) : (
        <PackageOpen size={23}/>
      )}
    </span>
  );
}

function MaterialVisual({material}: {material: Material}) {
  const references = referenceLabel(material);

  return (
    <span className="quote-material-visual">
      <MaterialThumbnail material={material}/>
      <span className="quote-material-copy">
        <strong className="quote-material-description">{material.name}</strong>
        <span className="quote-material-references" title={references}>
          <small>Referências</small>
          {references || 'Nenhuma referência cadastrada'}
        </span>
        <span className="quote-material-internal-code">
          <small>Código interno</small>
          {material.internalCode || 'Não informado'}
        </span>
      </span>
    </span>
  );
}

export function QuoteMaterialPicker({
  materials,
  value,
  itemNumber,
  onChange,
}: {
  materials: Material[];
  value: string;
  itemNumber: number;
  onChange: (materialId: string) => void;
}) {
  const labelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState<string | null>(null);
  const ordered = useMemo(
    () => [...materials].sort((left, right) =>
      left.name.localeCompare(right.name, 'pt-BR', {sensitivity: 'base', numeric: true}),
    ),
    [materials],
  );
  const selected = ordered.find(material => material.id === value) ?? null;
  const filtered = useMemo(() => {
    const term = normalize(search?.trim() ?? '');
    return term ? ordered.filter(material => searchableMaterial(material).includes(term)) : ordered;
  }, [ordered, search]);

  return (
    <div className="field quote-material-field" ref={container}>
      <span id={labelId}>Produto *</span>
      <Combobox
        items={ordered}
        filteredItems={filtered}
        value={selected}
        inputValue={search ?? ''}
        autoHighlight
        filter={null}
        itemToStringLabel={material => material.name}
        itemToStringValue={material => material.id}
        isItemEqualToValue={(left, right) => left.id === right.id}
        onOpenChange={open => setSearch(open ? '' : null)}
        onValueChange={material => {
          onChange(material?.id ?? '');
          setSearch(null);
        }}
        onInputValueChange={(text, event) => {
          if (event.reason === 'input-change') setSearch(text);
        }}
      >
        <div ref={anchor} className="quote-material-anchor">
          <ComboboxTrigger
            className="quote-material-trigger"
            aria-labelledby={labelId}
            aria-required="true"
            title={selected ? `Alterar produto do item ${itemNumber}` : `Selecionar produto do item ${itemNumber}`}
          >
            <ComboboxValue>
              {current => current
                ? <MaterialVisual material={current as Material}/>
                : <span className="quote-material-placeholder">Selecione um produto</span>}
            </ComboboxValue>
          </ComboboxTrigger>
        </div>
        <ComboboxContent
          anchor={anchor}
          portalContainer={container}
          className="quote-material-options"
          aria-label={`Materiais disponíveis para o item ${itemNumber}`}
        >
          <ComboboxInput
            className="quote-material-search"
            placeholder="Buscar por descrição, referência ou código interno"
            aria-label="Buscar material"
            autoComplete="off"
            showTrigger={false}
          />
          <ComboboxEmpty>Nenhum material encontrado.</ComboboxEmpty>
          <ComboboxList>
            {(material: Material) => (
              <ComboboxItem
                key={material.id}
                value={material}
                className="quote-material-option"
                data-material-id={material.id}
              >
                <MaterialVisual material={material}/>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
