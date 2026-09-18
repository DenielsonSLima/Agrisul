import {dateLabel, decimalLabel, moneyLabel, monthLabel} from '@/shared/utils/presentation';
import type {LoadReportFilters, ReportColumn, ReportKind, ReportValue} from '../types';
export function reportCell(value: ReportValue | undefined, column: ReportColumn) {
  if (column.format === 'money') return moneyLabel(value);
  if (column.format === 'decimal') return decimalLabel(value);
  if (column.format === 'date') return dateLabel(String(value || ''));
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
export function monthRange(month: string) {
  const [year,value]=month.split('-').map(Number);
  const end=new Date(year,value,0).getDate();
  return {from:`${month}-01`,to:`${month}-${String(end).padStart(2,'0')}`};
}
export function reportPeriod(kind: ReportKind, month: string, filters?: LoadReportFilters) {
  if (kind === 'farms') return 'Cadastro atual · Todas as fazendas do espaço de trabalho';
  if (kind === 'contracts') return 'Cadastro atual · Todos os contratos da empresa';
  if (kind === 'loads' && filters) {
    const period=filters.from===filters.to?dateLabel(filters.from):`${dateLabel(filters.from)} a ${dateLabel(filters.to)}`;
    const details=[filters.search&&`Busca: “${filters.search}”`,filters.farmName&&`Fazenda: ${filters.farmName}`,filters.plotName&&`Talhão: ${filters.plotName}`].filter(Boolean);
    return `Data do carregamento: ${period}${details.length?` · ${details.join(' · ')}`:''}`;
  }
  return `${kind === 'financial' ? 'Competência' : 'Data do carregamento'}: ${monthLabel(month)}`;
}
