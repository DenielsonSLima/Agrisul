import {decimalLabel, moneyLabel} from '@/shared/utils/presentation';
import {agendaKinds, type AgendaDay, type AgendaKind} from '../types';
const labels: Record<AgendaKind, [string, string]> = {
  contract:['contrato cadastrado','contratos cadastrados'], start:['início de contrato','inícios de contrato'],
  end:['término previsto','términos previstos'], load:['carregamento','carregamentos'],
  receipt:['recebimento','recebimentos'], advance:['adiantamento','adiantamentos'], refund:['estorno','estornos'],
};
export const agendaColors: Record<AgendaKind, string> = {contract:'#5877b7',start:'#9670c5',end:'#dc9656',load:'#299581',receipt:'#78a540',advance:'#b69a33',refund:'#a36e55'};
export const agendaFilterLabel = (kind: AgendaKind | '') => agendaKinds.find(item => item.id === kind)?.label ?? 'Todos os eventos';
export const agendaSummaryLabel = (item: AgendaDay['summary'][number]) => `${item.count} ${labels[item.kind][item.count === 1 ? 0 : 1]}`;
export const agendaSummaryValue = (item: AgendaDay['summary'][number]) => [item.volume ? `${decimalLabel(item.volume)} t` : '', item.amount ? moneyLabel(item.amount) : ''].filter(Boolean).join(' · ');
