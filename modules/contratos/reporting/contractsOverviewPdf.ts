import type { jsPDF } from 'jspdf';
import type { BillingContract, ContractListSummary } from '../types';

export type ContractsOverviewContext = { doc: jsPDF; x: number; y: number; width: number; height: number };
export type ContractsOverviewData = { contracts: BillingContract[]; summary: ContractListSummary; total: number };
type Color = [number, number, number];
type Field = 'grossAmount' | 'discountAmount' | 'netAmount' | 'receivedAmount' | 'pendingAmount';
const colors = {
  ink: [24, 48, 37] as Color, muted: [88, 105, 95] as Color,
  forest: [21, 61, 44] as Color, border: [217, 229, 221] as Color,
  gross: [84, 168, 115] as Color, net: [31, 116, 73] as Color,
  expense: [181, 130, 53] as Color, red: [174, 46, 53] as Color,
  white: [255, 255, 255] as Color,
};
const numeric = (input: unknown): number | null => {
  if (input === null || input === undefined || input === '') return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
};
const money = (amount: number | null) => amount === null ? 'n/d' : amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const reference = (index: number) => `C${String(index + 1).padStart(2, '0')}`;
const date = (input: string) => /^\d{4}-\d{2}-\d{2}/.test(input) ? input.slice(0, 10).split('-').reverse().join('/') : 'Sem data';
const amount = (contract: BillingContract, field: Field) => {
  const pending = contract.billingPending || contract.financialTotals?.billingPending;
  if (pending && (field === 'grossAmount' || field === 'netAmount' || field === 'pendingAmount')) return null;
  return numeric(contract.financialTotals?.[field]);
};

function text(doc: jsPDF, content: string, x: number, y: number, size = 8, color = colors.ink, bold = false, align: 'left' | 'right' | 'center' = 'left') {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(content, x, y, { align });
}

function fit(doc: jsPDF, content: string, x: number, y: number, width: number, size: number, color = colors.ink, bold = false, align: 'left' | 'right' | 'center' = 'left') {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const scaled = Math.max(6, Math.min(size, size * width / Math.max(doc.getTextWidth(content), 0.1)));
  doc.setFontSize(scaled);
  let fitted = content;
  while (doc.getTextWidth(fitted) > width && fitted.length > 4) fitted = `${fitted.slice(0, -4)}...`;
  text(doc, fitted, x, y, scaled, color, bold, align);
}

function line(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, color = colors.border, thickness = 0.2) {
  doc.setDrawColor(...color);
  doc.setLineWidth(thickness);
  doc.line(x1, y1, x2, y2);
}

function compact(value: number) {
  const absolute = Math.abs(value);
  const scale = absolute >= 1e6 ? 1e6 : absolute >= 1e3 ? 1e3 : 1;
  return `${(value / scale).toLocaleString('pt-BR', { maximumFractionDigits: scale === 1 ? (absolute > 0 && absolute < 1 ? 2 : 0) : 1 })}${scale === 1e6 ? ' mi' : scale === 1e3 ? ' mil' : ''}`;
}

function header(ctx: ContractsOverviewContext, data: ContractsOverviewData) {
  const { doc, x, y, width } = ctx;
  doc.setFillColor(...colors.forest);
  doc.rect(x, y, width, 14, 'F');
  text(doc, 'COMPARATIVO FINANCEIRO', x + 4, y + 6, 12, colors.white, true);
  text(doc, 'Bruto na barra total e líquido no preenchimento interno - valores em R$', x + 4, y + 11, 7, [205, 227, 213]);
  text(doc, `${data.total} ${data.total === 1 ? 'contrato' : 'contratos'}`, x + width - 4, y + 6, 8, colors.white, true, 'right');
  const { summary } = data;
  const pending = summary.billingPending;
  const metrics = [
    { label: 'Faturado bruto', value: pending ? null : numeric(summary.grossAmount), color: colors.ink, pending },
    { label: 'Despesas / descontos', value: numeric(summary.discountAmount), color: colors.expense },
    { label: 'Líquido consolidado', value: pending ? null : numeric(summary.netAmount), color: colors.net, pending },
    { label: 'Recebidos', value: numeric(summary.receivedAmount), color: colors.ink },
    { label: 'A receber', value: pending ? null : numeric(summary.pendingAmount), color: colors.red, pending },
    { label: 'Excedente recebido', value: pending ? null : numeric(summary.creditAmount), color: colors.ink, pending },
  ];
  const columnWidth = width / metrics.length;
  metrics.forEach((metric, index) => {
    const at = x + columnWidth * index;
    if (index) line(doc, at, y + 18, at, y + 31);
    text(doc, metric.label, at + 3, y + 21, 7, colors.muted);
    fit(doc, metric.pending ? 'Aguardando ATR' : money(metric.value), at + 3, y + 28, columnWidth - 6, 10.5, metric.color, true);
  });
  line(doc, x, y + 33, x + width, y + 33);
}

function bars(ctx: ContractsOverviewContext, data: ContractsOverviewData) {
  const { doc, x, y, width, height } = ctx;
  const { contracts } = data;
  text(doc, 'Bruto', x + 4, y + 38, 6.5, colors.muted);
  text(doc, 'Líquido', x + 25, y + 38, 6.5, colors.muted);
  doc.setFillColor(...colors.gross); doc.rect(x, y + 35.8, 2.5, 2.5, 'F');
  doc.setFillColor(...colors.net); doc.rect(x + 21, y + 35.8, 2.5, 2.5, 'F');
  text(doc, 'Valores completos na matriz e no detalhamento anterior', x + width, y + 38, 6, colors.muted, false, 'right');
  const left = x + 26;
  const right = x + width;
  const top = y + 44;
  const bottom = y + height - 45;
  const values = contracts.flatMap((contract) => [amount(contract, 'grossAmount'), amount(contract, 'netAmount')]).filter((entry): entry is number => entry !== null);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const low = minimum < 0 ? minimum * 1.10 : 0;
  const high = maximum > 0 ? maximum * 1.10 : minimum < 0 ? 0 : 1;
  const at = (entry: number) => bottom - (entry - low) / (high - low) * (bottom - top);
  const zero = at(0);
  for (let tick = 0; tick <= 3; tick++) {
    const entry = low + (high - low) * tick / 3;
    line(doc, left, at(entry), right, at(entry));
    text(doc, compact(entry), left - 2, at(entry) + 0.7, 6, colors.muted, false, 'right');
  }
  line(doc, left, zero, right, zero, colors.muted);
  if (!contracts.length) {
    text(doc, 'Nenhum contrato no filtro', left + 3, top + 10, 9, colors.muted);
    return;
  }
  const slot = (right - left) / contracts.length;
  const barWidth = Math.min(13, slot * 0.48);
  const labelEvery = Math.max(1, Math.ceil(8 / slot));
  contracts.forEach((contract, index) => {
    const center = left + slot * (index + 0.5);
    const gross = amount(contract, 'grossAmount');
    const net = amount(contract, 'netAmount');
    if (gross !== null) {
      doc.setFillColor(...colors.gross);
      doc.rect(center - barWidth / 2, Math.min(zero, at(gross)), barWidth, Math.abs(zero - at(gross)), 'F');
    }
    if (net !== null) {
      const innerWidth = barWidth * 0.72;
      doc.setFillColor(...colors.net);
      doc.rect(center - innerWidth / 2, Math.min(zero, at(net)), innerWidth, Math.abs(zero - at(net)), 'F');
    }
    if (gross === null || net === null) {
      if (contracts.length <= 8) text(doc, 'n/d', center, bottom - 3, 7, colors.muted, false, 'center');
      else {
        const radius = Math.min(0.6, slot * 0.3);
        line(doc, center - radius, bottom - 3 - radius, center + radius, bottom - 3 + radius, colors.muted);
        line(doc, center - radius, bottom - 3 + radius, center + radius, bottom - 3 - radius, colors.muted);
      }
    }
    if (contracts.length <= 3 && gross !== null) {
      fit(doc, money(gross), center, gross >= 0 ? at(gross) - 1.5 : at(gross) + 3, slot - 3, 7.5, colors.ink, true, 'center');
    }
    if (index !== contracts.length - 1 && (index % labelEvery !== 0 || contracts.length - 1 - index < labelEvery)) return;
    if (contracts.length <= 3) {
      fit(doc, `${reference(index)} - ${contract.typeName || 'Tipo não informado'}`, center, bottom + 4.5, slot - 4, 7, colors.ink, true, 'center');
      fit(doc, `${date(contract.startDate)} - ${contract.clientName || 'Cliente não informado'}`, center, bottom + 8.5, slot - 4, 6.5, colors.muted, false, 'center');
    } else text(doc, reference(index), Math.max(left + 2, Math.min(right - 2, center)), bottom + 5, 6, colors.muted, false, 'center');
  });
}

function matrix(ctx: ContractsOverviewContext, data: ContractsOverviewData) {
  const { doc, x, y, width, height } = ctx;
  const count = data.contracts.length;
  if (!count) return;
  const labelWidth = 26;
  const maximumColumns = Math.max(1, Math.floor((width - labelWidth) / 29));
  const displayed = Math.min(count, maximumColumns);
  const indices = Array.from({ length: displayed }, (_, index) => displayed === 1 ? 0 : Math.round(index * (count - 1) / (displayed - 1)));
  const columnWidth = (width - labelWidth) / displayed;
  const top = y + height - 31;
  const rowHeight = 4.7;
  const rows: Array<{ label: string; field: Field; color: Color; fill: Color }> = [
    { label: 'Bruto', field: 'grossAmount', color: colors.ink, fill: [250, 252, 250] },
    { label: 'Despesas', field: 'discountAmount', color: [142, 95, 30], fill: [253, 249, 241] },
    { label: 'Líquido', field: 'netAmount', color: colors.net, fill: [237, 246, 240] },
    { label: 'Recebidos', field: 'receivedAmount', color: colors.ink, fill: [250, 252, 250] },
    { label: 'A receber', field: 'pendingAmount', color: colors.red, fill: [253, 244, 244] },
  ];
  text(doc, count > displayed ? 'Matriz: referências selecionadas' : 'Matriz por contrato', x, top - 1.4, 6, colors.muted);
  indices.forEach((index, column) => text(doc, reference(index), x + labelWidth + columnWidth * (column + 0.5), top - 1.4, 6.5, colors.ink, true, 'center'));
  rows.forEach((row, rowIndex) => {
    const rowY = top + rowIndex * rowHeight;
    doc.setFillColor(...row.fill);
    doc.rect(x, rowY, width, rowHeight, 'F');
    text(doc, row.label, x + 2, rowY + 3.2, 6.5, row.color, true);
    indices.forEach((index, column) => {
      const at = x + labelWidth + columnWidth * column;
      line(doc, at, rowY, at, rowY + rowHeight, [233, 239, 234], 0.1);
      fit(doc, money(amount(data.contracts[index], row.field)), at + columnWidth / 2, rowY + 3.2, columnWidth - 4, 8, row.color, row.field === 'netAmount' || row.field === 'pendingAmount', 'center');
    });
  });
}

/** Presentation only: official backend values, with no client-side financial totals. */
export function drawContractsOverviewPdf(ctx: ContractsOverviewContext, data: ContractsOverviewData): void {
  header(ctx, data);
  bars(ctx, data);
  matrix(ctx, data);
  const { doc, x, y, height } = ctx;
  text(doc, 'Todas as barras são exibidas. Em seleções extensas, rótulos e matriz são amostrados; valores completos na tabela anterior. n/d = valor não disponível.', x, y + height - 3.8, 6, colors.muted);
  text(doc, 'Despesas são descontos e acordos informados, não todos os custos de produção. Recebidos já incluem adiantamentos: não somar novamente.', x, y + height - 0.5, 6, colors.muted);
}
