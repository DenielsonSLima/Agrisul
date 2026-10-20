import type {WeighingDetail} from '../types';

export function weightLabel(value: string | null | undefined) {
  return value == null || value === '' ? 'Pendente' : new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 7}).format(Number(value));
}
export function percentLabel(value: string | null | undefined) {
  return value == null || value === '' ? 'Pendente' : `${new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 2}).format(Number(value))}%`;
}
export function weightInput(value: string | null | undefined) {
  return value == null || value === '' ? '' : value.replace('.', ',');
}

// CSV only presents the values returned by the database; it performs no business calculations.
export function exportWeighingCsv(detail: WeighingDetail) {
  const numeric = (value: string | null | undefined) => ({numeric: value ?? ''});
  const rows: unknown[][] = [['Comparativo de pesagem de cana'], ['Parceiro', detail.control.partnerName], ['Safra', detail.control.season],
    ['Data', 'Hora', 'Ticket', 'Frota', 'Placa', 'Tipo', 'Tara AGRISUL (kg)', 'Bruto AGRISUL (kg)', 'Líquido AGRISUL (kg)', `Líquido ${detail.control.partnerName} (kg)`, 'Diferença (kg)']];
  for (const entry of detail.entries) {
    for (const component of entry.components) rows.push([entry.weighedAt, entry.weighedTime, entry.ticket, component.fleetNumber, component.plate,
      component.kind === 'truck' ? 'Caminhão' : 'Reboque', numeric(component.tareKg), numeric(component.grossKg), numeric(component.netKg), numeric(component.partnerNetKg), numeric(component.differenceKg)]);
    rows.push([entry.weighedAt, '', 'SUBTOTAL DA VIAGEM', '', '', '', '', '', numeric(entry.agrisulNetKg), numeric(entry.partnerNetKg), numeric(entry.differenceKg)]);
  }
  rows.push(['TOTAL', '', '', '', '', '', '', '', numeric(detail.summary.agrisulNetKg), numeric(detail.summary.partnerNetKg), numeric(detail.summary.differenceKg)]);
  const cell = (value: unknown) => {
    if (value && typeof value === 'object' && 'numeric' in value) {
      return `"${String(value.numeric).replace('.', ',')}"`;
    }
    let text = value == null ? '' : String(value);
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const blob = new Blob(['\uFEFF', rows.map(row => row.map(cell).join(';')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pesagem-cana-${detail.control.startDate}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
