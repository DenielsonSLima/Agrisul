'use client';

import {useId} from 'react';
import type {Signature} from '@/modules/cadastro/assinaturas/types';
import {Field} from '@/shared/components/Common';

export function QuoteRequesterField({value, requesters, onChange}: {
  value: string;
  requesters: Signature[];
  onChange: (name: string, signatureId: string) => void;
}) {
  const optionsId = useId();
  return (
    <Field label="Solicitante *">
      <input
        value={value}
        maxLength={150}
        list={optionsId}
        placeholder="Digite o nome do solicitante"
        autoComplete="off"
        onChange={event => {
          const name = event.target.value;
          const signature = requesters.find(requester => requester.name === name);
          onChange(name, signature?.id ?? '');
        }}
      />
      <datalist id={optionsId}>
        {requesters.map(requester => <option key={requester.id} value={requester.name}/>)}
      </datalist>
      <small className="quote-field-help">Digite o nome ou escolha uma sugestão. Não é necessário cadastrar uma assinatura.</small>
    </Field>
  );
}
