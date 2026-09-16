export type AgendaKind = 'contract' | 'start' | 'end' | 'load' | 'receipt' | 'advance';
export type AgendaEvent = {
  id: string; date: string; kind: AgendaKind; title: string; detail: string;
  contractId: string; contractNumber: string; amount: string; volume: string; status: string;
};
export type AgendaDay = {
  date: string; dayNumber: number; gridColumn: number; inMonth: boolean; isToday: boolean;
  eventCount: number; kinds: AgendaKind[]; events: AgendaEvent[];
  summary: {kind: AgendaKind; count: number; volume: string; amount: string}[];
};
export type AgendaData = {month: string; eventCount: number; days: AgendaDay[]};
export type AgendaSnapshot = {data: AgendaData; companyId: string; kind: AgendaKind | ''};
export const agendaKinds: {id: AgendaKind; label: string}[] = [
  {id: 'contract', label: 'Contrato cadastrado'}, {id: 'start', label: 'Início de contrato'},
  {id: 'end', label: 'Término previsto'}, {id: 'load', label: 'Carregamento'},
  {id: 'receipt', label: 'Recebimento'}, {id: 'advance', label: 'Adiantamento'},
];
