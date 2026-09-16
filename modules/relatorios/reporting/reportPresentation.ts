import {dateLabel, decimalLabel, moneyLabel, monthLabel} from '@/shared/utils/presentation';
import type {ReportColumn, ReportKind, ReportValue} from '../types';
export function reportCell(value: ReportValue | undefined, column: ReportColumn) {
  if (column.format === 'money') return moneyLabel(value);
  if (column.format === 'decimal') return decimalLabel(value);
  if (column.format === 'date') return dateLabel(String(value || ''));
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
export function reportPeriod(kind: ReportKind, month: string) {
  if (kind === 'farms') return 'Cadastro atual · Todas as fazendas do espaço de trabalho';
  if (kind === 'contracts') return 'Cadastro atual · Todos os contratos da empresa';
  return `${kind === 'financial' ? 'Competência' : 'Data do carregamento'}: ${monthLabel(month)}`;
}
