// Formatting and calendar navigation only; business totals are supplied by RPC.
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export const currentMonth = () => localDay().slice(0, 7);
export function monthLabel(month: string) {
  return new Intl.DateTimeFormat('pt-BR', {month: 'long', year: 'numeric'}).format(new Date(`${month}-01T12:00:00`));
}
export function dateLabel(day: string) {
  if (!day) return '—';
  return new Intl.DateTimeFormat('pt-BR').format(new Date(`${day}T12:00:00`));
}
export function decimalLabel(value: string | number | boolean | null | undefined, digits = 2) {
  if (value === '' || value === null || value === undefined) return 'A apurar';
  return new Intl.NumberFormat('pt-BR', {minimumFractionDigits: digits, maximumFractionDigits: digits}).format(Number(value));
}
export function moneyLabel(value: string | number | boolean | null | undefined) {
  return value === '' || value === null || value === undefined ? 'A apurar' : `R$ ${decimalLabel(value)}`;
}
