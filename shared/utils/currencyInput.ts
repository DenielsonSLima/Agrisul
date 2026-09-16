// Currency input uses strings throughout so formatting cannot round money or rates.
export function currencyDecimal(value: string): string | null {
  const text = value.trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
  const decimal = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  if (!/^\d*(?:\.\d*)?$/.test(decimal)) return null;
  if (!/\d/.test(decimal)) return '';
  const [integer, fraction] = decimal.split('.');
  return (integer.replace(/^0+(?=\d)/, '') || '0') + (fraction === undefined ? '' : '.' + fraction);
}

export function currencyClipboardDecimal(value: string): string | null {
  const text = value.trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
  // A Brazilian amount copied without cents can still contain thousands separators.
  return currencyDecimal(/^\d{1,3}(?:\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text);
}

export function formatCurrencyInput(decimal: string): string {
  if (!decimal) return '';
  const [integer, fraction = ''] = decimal.split('.');
  return 'R$ ' + integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + fraction.padEnd(2, '0');
}

export function currencyPayload(decimal: string): string {
  return decimal.replace(/\.$/, '');
}

export function currencyEditableDecimal(decimal: string, displayPosition: number): string {
  if (!decimal) return decimal;
  const comma = formatCurrencyInput(decimal).indexOf(',');
  if (displayPosition <= comma) return decimal;
  const [integer, fraction = ''] = decimal.split('.');
  // Clicking a displayed cent must edit that cent, including a padded zero.
  return integer + '.' + fraction.padEnd(Math.min(2, displayPosition - comma - 1), '0');
}

export function currencyRawPosition(decimal: string, displayPosition: number): number {
  const beforeCursor = formatCurrencyInput(decimal).slice(3, Math.max(3, displayPosition));
  return Math.min(decimal.length, beforeCursor.replace(/\./g, '').length);
}

export function currencyDisplayPosition(decimal: string, rawPosition: number): number {
  const display = formatCurrencyInput(decimal);
  if (!display) return 0;
  let count = 0;
  for (let index = 3; index < display.length; index++) {
    if (count >= rawPosition) return index;
    if (display[index] !== '.') count++;
  }
  return display.length;
}

export function editCurrencyInput(decimal: string, start: number, end: number, inserted: string, fractionDigits: number) {
  const text = inserted.replace(',', '.');
  if (!/^\d*(?:\.\d*)?$/.test(text)) return null;
  const candidate = decimal.slice(0, start) + text + decimal.slice(end);
  const next = currencyDecimal(candidate);
  if (next === null || (next.split('.')[1]?.length ?? 0) > fractionDigits) return null;
  const removedZeros = candidate.length - next.length;
  return {decimal: next, cursor: Math.max(0, start + text.length - removedZeros)};
}
