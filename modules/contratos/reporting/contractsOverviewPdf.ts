import type { jsPDF } from 'jspdf';
import type { BillingContract, ContractListSummary } from '../types';

type Context = { doc: jsPDF; x: number; y: number; width: number; height: number };
type OverviewData = { contracts: BillingContract[]; summary: ContractListSummary; total: number };
type Color = [number, number, number];
type Series = { label: string; color: Color; values: Array<number | null> };
const colors = {
  ink: [24, 48, 37] as Color,
  muted: [88, 105, 95] as Color,
  forest: [21, 61, 44] as Color,
  paper: [247, 250, 248] as Color,
  border: [217, 229, 221] as Color,
  gross: [84, 168, 115] as Color,
  net: [31, 116, 73] as Color,
  expense: [181, 130, 53] as Color,
  volume: [106, 146, 157] as Color,
  red: [174, 46, 53] as Color,
  rose: [253, 244, 244] as Color,
  white: [255, 255, 255] as Color,
};
const value = (input: unknown): number | null => {
  if (input === null || input === undefined || input === '') return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
};
const money = (amount: number | null) => amount === null ? 'n/d' : amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const volume = (amount: number | null) => amount === null ? 'n/d' : `${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`;
const ref = (index: number) => `C${String(index + 1).padStart(2, '0')}`;

function text(doc: jsPDF, content: string, x: number, y: number, size = 8, color = colors.ink, bold = false) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(content, x, y);
}

function fit(doc: jsPDF, content: string, x: number, y: number, width: number, size: number, color: Color, bold = false) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const scaled = Math.max(6, Math.min(size, size * width / Math.max(doc.getTextWidth(content), 0.1)));
  text(doc, content, x, y, scaled, color, bold);
}

function panel(doc: jsPDF, x: number, y: number, width: number, height: number, fill = colors.paper) {
  doc.setFillColor(...fill);
  doc.setDrawColor(...colors.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, width, height, 2, 2, 'FD');
}

function compact(amount: number) {
  const absolute = Math.abs(amount);
  const scale = absolute >= 1e6 ? 1e6 : absolute >= 1e3 ? 1e3 : 1;
  const digits = scale === 1 ? (absolute > 0 && absolute < 1 ? 2 : 0) : 1;
  return `${(amount / scale).toLocaleString('pt-BR', { maximumFractionDigits: digits })}${scale === 1e6 ? ' mi' : scale === 1e3 ? ' mil' : ''}`;
}

function chart(ctx: Context, title: string, unit: string, series: Series[], count: number) {
  const { doc, x, y, width, height } = ctx;
  panel(doc, x, y, width, height);
  text(doc, title, x + 4, y + 6, 9, colors.ink, true);
  let legendX = x + 4;
  for (const entry of series) {
    doc.setFillColor(...entry.color);
    doc.rect(legendX, y + 9, 2, 2, 'F');
    text(doc, entry.label, legendX + 3.5, y + 10.8, 6.5, colors.muted);
    legendX += doc.getTextWidth(entry.label) + 10;
  }
  if (series.some((entry) => entry.values.some((amount) => amount === null))) {
    text(doc, 'x n/d', x + width - 13, y + 10.8, 6.5, colors.muted);
  }
  const left = x + 19;
  const right = x + width - 4;
  const top = y + 18;
  const bottom = y + height - 13;
  const values = series.flatMap((entry) => entry.values).filter((amount): amount is number => amount !== null);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const low = minimum < 0 ? minimum * 1.1 : 0;
  const high = maximum > 0 ? maximum * 1.1 : minimum < 0 ? 0 : 1;
  const toY = (amount: number) => bottom - (amount - low) / (high - low) * (bottom - top);
  const zero = toY(0);
  for (let index = 0; index <= 3; index++) {
    const amount = low + (high - low) * index / 3;
    const at = toY(amount);
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.15);
    doc.line(left, at, right, at);
    const tick = compact(amount);
    doc.setFontSize(6);
    doc.setTextColor(...colors.muted);
    doc.setFont('helvetica', 'normal');
    doc.text(tick, left - 2, at + 0.7, { align: 'right' });
  }
  text(doc, unit, x + 4, top - 2, 6, colors.muted);
  doc.setDrawColor(...colors.muted);
  doc.setLineWidth(0.25);
  doc.line(left, zero, right, zero);
  if (!count) {
    text(doc, 'Nenhum contrato no filtro', left + 3, top + 10, 8, colors.muted);
    return false;
  }
  const slot = (right - left) / count;
  const barWidth = Math.min(6, slot * 0.74 / series.length);
  const verticalLabels = count > 12;
  const labelEvery = Math.max(1, Math.ceil((verticalLabels ? 2.25 : 9) / slot));
  series.forEach((entry, seriesIndex) => {
    entry.values.forEach((amount, index) => {
      const center = left + slot * (index + 0.5);
      if (amount === null) {
        if (count <= 12) {
          text(doc, 'n/d', center - 1.8, bottom - 2 - seriesIndex * 2.6, 6, colors.muted);
        } else {
          const radius = Math.min(0.7, slot * 0.3);
          const at = bottom - 2 - seriesIndex * 2;
          doc.setDrawColor(...colors.muted);
          doc.setLineWidth(0.2);
          doc.line(center - radius, at - radius, center + radius, at + radius);
          doc.line(center - radius, at + radius, center + radius, at - radius);
        }
        return;
      }
      const barX = center - barWidth * series.length / 2 + seriesIndex * barWidth;
      const amountY = toY(amount);
      doc.setFillColor(...entry.color);
      doc.rect(barX, Math.min(zero, amountY), barWidth * 0.88, Math.abs(zero - amountY), 'F');
      if (count <= 3 && series.length === 1) {
        const label = volume(amount);
        doc.setFontSize(7);
        doc.setTextColor(...entry.color);
        doc.setFont('helvetica', 'bold');
        doc.text(label, center, amount >= 0 ? amountY - 1.5 : amountY + 3, { align: 'center' });
      }
    });
  });
  for (let index = 0; index < count; index++) {
    if (index % labelEvery !== 0 && index !== count - 1) continue;
    if (index !== count - 1 && count - 1 - index < labelEvery) continue;
    const center = left + slot * (index + 0.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...colors.muted);
    if (verticalLabels) doc.text(ref(index), center + 0.7, bottom + 10, { angle: 90 });
    else doc.text(ref(index), center, bottom + 5, { align: 'center' });
  }
  return labelEvery > 1;
}

function consolidated(ctx: Context, data: OverviewData) {
  const { doc, x, y, width, height } = ctx;
  const { summary } = data;
  const gap = 3;
  const netWidth = width * 0.30;
  const slopeWidth = width * 0.35;
  const sideX = x + netWidth + slopeWidth + gap * 2;
  const sideWidth = width - netWidth - slopeWidth - gap * 2;
  const pending = summary.billingPending;
  const net = pending ? null : value(summary.netAmount);
  const gross = pending ? null : value(summary.grossAmount);
  panel(doc, x, y, netWidth, height, colors.forest);
  text(doc, 'Líquido consolidado', x + 5, y + 7, 8, colors.white, true);
  fit(doc, pending ? 'Aguardando ATR' : money(net), x + 5, y + 18, netWidth - 10, pending ? 14 : 19, colors.white, true);
  text(doc, 'Despesas / descontos', x + 5, y + height - 9, 6.5, [192, 218, 202]);
  fit(doc, money(value(summary.discountAmount)), x + 5, y + height - 4, netWidth - 10, 10, colors.white, true);

  const slopeX = x + netWidth + gap;
  panel(doc, slopeX, y, slopeWidth, height);
  text(doc, 'Bruto / Líquido', slopeX + 4, y + 6, 8, colors.ink, true);
  text(doc, 'Comparação consolidada, não temporal', slopeX + 4, y + 10, 6, colors.muted);
  if (gross === null || net === null) {
    text(doc, pending ? 'Aguardando ATR' : 'Valores não disponíveis', slopeX + 4, y + 21, 9, colors.muted);
  } else {
    const maximum = Math.max(gross, net, 0);
    const minimum = Math.min(gross, net, 0);
    const range = maximum - minimum || 1;
    const at = (amount: number) => y + 22 - (amount - minimum) / range * 8;
    const firstX = slopeX + 12;
    const lastX = slopeX + slopeWidth - 12;
    doc.setDrawColor(...colors.net);
    doc.setLineWidth(0.7);
    doc.line(firstX, at(gross), lastX, at(net));
    [firstX, lastX].forEach((pointX, index) => {
      doc.setFillColor(...(index === 0 ? colors.gross : colors.net));
      doc.circle(pointX, at(index === 0 ? gross : net), 1.2, 'F');
    });
    text(doc, 'Bruto', slopeX + 4, y + height - 8, 6.5, colors.muted);
    text(doc, 'Líquido', slopeX + slopeWidth / 2 + 1, y + height - 8, 6.5, colors.muted);
    fit(doc, money(gross), slopeX + 4, y + height - 3, slopeWidth / 2 - 6, 9, colors.ink, true);
    fit(doc, money(net), slopeX + slopeWidth / 2 + 1, y + height - 3, slopeWidth / 2 - 5, 9, colors.net, true);
  }

  panel(doc, sideX, y, sideWidth, height, colors.rose);
  text(doc, 'A receber', sideX + 4, y + 6, 8, colors.red, true);
  fit(doc, pending ? 'Aguardando ATR' : money(value(summary.pendingAmount)), sideX + 4, y + 14, sideWidth - 8, 15, colors.red, true);
  doc.setDrawColor(237, 214, 215);
  doc.line(sideX + 4, y + 18, sideX + sideWidth - 4, y + 18);
  const half = (sideWidth - 8) / 2;
  text(doc, 'Volume carregado', sideX + 4, y + 23, 6, colors.muted);
  text(doc, 'Recebidos', sideX + 4 + half, y + 23, 6, colors.muted);
  fit(doc, volume(value(summary.loadedVolume)), sideX + 4, y + height - 4, half - 3, 9, colors.ink, true);
  fit(doc, money(value(summary.receivedAmount)), sideX + 4 + half, y + height - 4, half - 1, 9, colors.ink, true);
}

/** One analytical page; financial amounts remain the official supplied values. */
export function drawContractsOverviewPdf(ctx: Context, data: OverviewData): void {
  const { doc, x, y, width, height } = ctx;
  const contracts = data.contracts;
  text(doc, 'Visão executiva da carteira', x, y + 5, 13, colors.ink, true);
  const countLabel = `${data.total} ${data.total === 1 ? 'contrato' : 'contratos'} no consolidado`;
  doc.setFontSize(7);
  doc.setTextColor(...colors.muted);
  doc.setFont('helvetica', 'normal');
  doc.text(countLabel, x + width, y + 5, { align: 'right' });
  const heroHeight = Math.min(36, Math.max(33, height * 0.28));
  consolidated({ doc, x, y: y + 10, width, height: heroHeight }, data);
  const chartY = y + heroHeight + 14;
  const chartHeight = height - heroHeight - 23;
  const gap = 4;
  const chartWidth = (width - gap) / 2;
  const financial = (contract: BillingContract, field: 'grossAmount' | 'netAmount') => {
    if (contract.billingPending || contract.financialTotals?.billingPending) return null;
    return value(contract.financialTotals?.[field]);
  };
  const sampledMoney = chart({ doc, x, y: chartY, width: chartWidth, height: chartHeight }, 'Comparativo financeiro', 'R$', [
    { label: 'Bruto', color: colors.gross, values: contracts.map((contract) => financial(contract, 'grossAmount')) },
    { label: 'Líquido', color: colors.net, values: contracts.map((contract) => financial(contract, 'netAmount')) },
    { label: 'Despesas', color: colors.expense, values: contracts.map((contract) => value(contract.financialTotals?.discountAmount)) },
  ], contracts.length);
  const sampledVolume = chart({ doc, x: x + chartWidth + gap, y: chartY, width: chartWidth, height: chartHeight }, 'Volume por contrato', 't', [
    { label: 'Volume carregado', color: colors.volume, values: contracts.map((contract) => value(contract.loadedVolume)) },
  ], contracts.length);
  const note = sampledMoney || sampledVolume
    ? 'Todos os contratos representados; rótulos amostrados. C01... remetem ao detalhamento seguinte.'
    : 'C01... remetem ao detalhamento seguinte. Valores monetários e volume usam escalas próprias.';
  text(doc, note, x, y + height - 4.5, 6, colors.muted);
  text(doc, 'Despesas / descontos refletem os acordos informados; não representam todos os custos de produção. n/d = valor não disponível.', x, y + height - 1, 6, colors.muted);
}
