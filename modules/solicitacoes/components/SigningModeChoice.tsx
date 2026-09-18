import {FileSignature, PenLine} from 'lucide-react';
import type {RequestSigningMode} from '../types';

export function SigningModeChoice({name, value, hasImage, disabled, onChange}: {name: string; value: RequestSigningMode; hasImage: boolean; disabled?: boolean; onChange: (mode: RequestSigningMode) => void}) {
  return <fieldset className="request-signing-mode" disabled={disabled}>
    <legend>Como a assinatura será incluída?</legend>
    <label className={value === 'registered' ? 'is-selected' : ''}>
      <input type="radio" name={name} value="registered" checked={value === 'registered'} disabled={!hasImage} onChange={() => onChange('registered')}/>
      <FileSignature size={18}/><span><strong>Assinatura cadastrada</strong><small>{hasImage ? 'Incluir a imagem PNG cadastrada no documento.' : 'Nenhuma imagem PNG cadastrada para esta pessoa.'}</small></span>
    </label>
    <label className={value === 'manual' ? 'is-selected' : ''}>
      <input type="radio" name={name} value="manual" checked={value === 'manual'} onChange={() => onChange('manual')}/>
      <PenLine size={18}/><span><strong>Assinatura manual</strong><small>Deixar o espaço em branco para assinar após a impressão.</small></span>
    </label>
  </fieldset>;
}
