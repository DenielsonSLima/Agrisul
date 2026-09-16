'use client';

import {useLayoutEffect, useRef, useState, type ComponentProps} from 'react';
import {currencyClipboardDecimal, currencyDecimal, currencyDisplayPosition, currencyEditableDecimal, currencyPayload, currencyRawPosition, editCurrencyInput, formatCurrencyInput} from '@/shared/utils/currencyInput';

type CurrencyInputProps = Omit<ComponentProps<'input'>, 'type' | 'inputMode' | 'value' | 'defaultValue' | 'onChange' | 'onKeyDown' | 'onPaste' | 'maxLength' | 'ref'> & {
  value?: string;
  defaultValue?: string | null;
  onValueChange?: (decimal: string) => void;
  maximumFractionDigits?: number;
};

export function CurrencyInput({value, defaultValue, onValueChange, maximumFractionDigits = 2, name, disabled, readOnly, placeholder = 'R$ 0,00', ...props}: CurrencyInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const cursor = useRef<number | null>(null);
  const [edit, setEdit] = useState(() => ({source: value, decimal: currencyDecimal(value ?? defaultValue ?? '') ?? ''}));
  if (value !== edit.source) setEdit({source: value, decimal: currencyDecimal(value ?? '') ?? ''});
  const decimal = edit.decimal;
  const display = formatCurrencyInput(decimal);

  useLayoutEffect(() => {
    if (cursor.current !== null && input.current === document.activeElement) {
      input.current?.setSelectionRange(cursor.current, cursor.current);
    }
    cursor.current = null;
  }, [edit]);

  function update(next: string, position: number) {
    const payload = currencyPayload(next);
    cursor.current = currencyDisplayPosition(next, position);
    setEdit({source: value === undefined ? undefined : payload, decimal: next});
    onValueChange?.(payload);
  }

  function replace(source: string, start: number, end: number, text: string) {
    const result = editCurrencyInput(source, start, end, text, maximumFractionDigits);
    if (result) update(result.decimal, result.cursor);
    else update(decimal, start);
  }

  return <>
    <input {...props} ref={input} type="text" inputMode="decimal" disabled={disabled} readOnly={readOnly} placeholder={placeholder} value={display}
      onChange={event => {
        const text = event.currentTarget.value;
        const newEnd = event.currentTarget.selectionStart ?? text.length;
        const oldEnd = display.length - (text.length - newEnd);
        let start = 0;
        while (start < Math.min(oldEnd, newEnd) && display[start] === text[start]) start++;
        const source = currencyEditableDecimal(decimal, oldEnd);
        const rawStart = currencyRawPosition(source, start), rawEnd = currencyRawPosition(source, oldEnd);
        const inserted = text.slice(start, newEnd);
        if ((inserted === ',' || inserted === '.') && start === oldEnd && decimal.includes('.')) {
          update(decimal, decimal.indexOf('.') + 1);
        } else if (!inserted && source.slice(rawStart, rawEnd) === '.') {
          update(source, (event.nativeEvent as InputEvent).inputType === 'deleteContentBackward' ? rawStart : rawEnd);
        } else replace(source, rawStart, rawEnd, inserted);
      }}
      onKeyDown={event => {
        if (readOnly || event.ctrlKey || event.metaKey || event.altKey) return;
        const element = event.currentTarget;
        const source = currencyEditableDecimal(decimal, element.selectionEnd ?? 0);
        let start = currencyRawPosition(source, element.selectionStart ?? 0);
        let end = currencyRawPosition(source, element.selectionEnd ?? 0);
        if (event.key === ',' || event.key === '.') {
          event.preventDefault();
          if (!decimal) update('0.', 2);
          else if (decimal.includes('.')) update(decimal, decimal.indexOf('.') + 1);
          else update(decimal + '.', decimal.length + 1);
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
          if (start === end) {
            if (event.key === 'Backspace') start = Math.max(0, start - 1);
            else end = Math.min(source.length, end + 1);
            if (source.slice(start, end) === '.') {
              update(source, event.key === 'Backspace' ? start : end);
              return;
            }
          }
          replace(source, start, end, '');
        }
      }}
      onPaste={event => {
        if (readOnly) return;
        event.preventDefault();
        const pasted = currencyClipboardDecimal(event.clipboardData.getData('text'));
        if (pasted === null) return;
        const source = currencyEditableDecimal(decimal, event.currentTarget.selectionEnd ?? 0);
        const start = currencyRawPosition(source, event.currentTarget.selectionStart ?? 0);
        const end = currencyRawPosition(source, event.currentTarget.selectionEnd ?? 0);
        replace(source, start, end, pasted);
      }}
    />
    {name && <input type="hidden" name={name} value={currencyPayload(decimal)} disabled={disabled}/>}
  </>;
}
