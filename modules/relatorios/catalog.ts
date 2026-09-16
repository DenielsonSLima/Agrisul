import type {ReportColumn, ReportKind} from './types';
export const reportCatalog: {id: ReportKind; title: string; description: string}[] = [
  {id: 'contracts', title: 'Contratos', description: 'Clientes, vigência, situação e volume contratado.'},
  {id: 'loads', title: 'Carregamentos', description: 'Entregas do mês, origem, documentos e ATR medido.'},
  {id: 'financial', title: 'Financeiro', description: 'Faturamento, descontos, recebimentos e saldos do mês.'},
  {id: 'farms', title: 'Fazendas e áreas', description: 'Áreas cadastradas, talhões e área disponível.'},
];
export const reportColumns: Record<ReportKind, ReportColumn[]> = {
  contracts: [{key:'contractNumber',label:'Contrato',width:28},{key:'clientName',label:'Cliente',width:68},{key:'status',label:'Situação',width:35},{key:'startDate',label:'Início',format:'date',width:32},{key:'endDate',label:'Término',format:'date',width:32},{key:'contractedVolume',label:'Contratado (t)',format:'decimal',width:45}],
  loads: [{key:'loadedAt',label:'Data',format:'date',width:25},{key:'contractNumber',label:'Contrato',width:24},{key:'clientName',label:'Cliente',width:44},{key:'farmName',label:'Fazenda',width:35},{key:'plotName',label:'Talhão',width:28},{key:'document',label:'Documento',width:32},{key:'volume',label:'Quantidade (t)',format:'decimal',width:30},{key:'atr',label:'ATR (kg/t)',format:'decimal',width:22}],
  financial: [{key:'clientName',label:'Cliente',width:48},{key:'contractNumber',label:'Contrato',width:25},{key:'grossAmount',label:'Bruto',format:'money',width:35},{key:'discountAmount',label:'Descontos',format:'money',width:32},{key:'netAmount',label:'Líquido',format:'money',width:35},{key:'receivedAmount',label:'Recebido',format:'money',width:35},{key:'pendingAmount',label:'Pendente',format:'money',width:30}],
  farms: [{key:'name',label:'Fazenda',width:60},{key:'city',label:'Cidade',width:46},{key:'state',label:'UF',width:14},{key:'plotCount',label:'Talhões',width:25},{key:'totalHa',label:'Total (ha)',format:'decimal',width:32},{key:'usedHa',label:'Em talhões (ha)',format:'decimal',width:32},{key:'preservedHa',label:'Disponível (ha)',format:'decimal',width:31}],
};
export const reportMetricColumns: Record<ReportKind, ReportColumn[]> = {
  contracts: [{key:'contractCount',label:'Contratos',width:1},{key:'activeCount',label:'Ativos',width:1}],
  loads: [{key:'loadCount',label:'Carregamentos',width:1},{key:'volume',label:'Quantidade (t)',format:'decimal',width:1},{key:'averageAtr',label:'ATR médio ponderado',format:'decimal',width:1}],
  financial: [{key:'grossAmount',label:'Faturamento bruto',format:'money',width:1},{key:'discountAmount',label:'Descontos',format:'money',width:1},{key:'netAmount',label:'Valor líquido',format:'money',width:1},{key:'receivedAmount',label:'Recebido',format:'money',width:1},{key:'pendingAmount',label:'Pendente',format:'money',width:1},{key:'creditAmount',label:'Crédito',format:'money',width:1}],
  farms: [{key:'farmCount',label:'Fazendas',width:1},{key:'totalHa',label:'Área total (ha)',format:'decimal',width:1},{key:'usedHa',label:'Em talhões (ha)',format:'decimal',width:1},{key:'preservedHa',label:'Disponível (ha)',format:'decimal',width:1}],
};
