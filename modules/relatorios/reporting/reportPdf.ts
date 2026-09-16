import {drawReportPdfHeader, drawReportPdfWatermark, REPORT_MARGIN_MM} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {reportCatalog, reportColumns, reportMetricColumns} from '../catalog';
import {reportCell, reportPeriod} from './reportPresentation';
import type {ReportBrand, ReportSnapshot} from '../types';

// Arithmetic is restricted to PDF page and text geometry.
export async function createReportPdf(snapshot: ReportSnapshot, brand: ReportBrand) {
  const {jsPDF} = await import('jspdf');
  const doc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4', compress:true});
  const {data, month} = snapshot;
  const title = reportCatalog.find(item => item.id === data.kind)!.title;
  const columns = reportColumns[data.kind];
  const margin = REPORT_MARGIN_MM, pageWidth = doc.internal.pageSize.getWidth(), pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2, bottom = pageHeight - margin - 10;
  const widthUnits = columns.reduce((sum, column) => sum + column.width, 0);
  const widths = columns.map(column => column.width / widthUnits * contentWidth);
  const [logo, watermark] = await Promise.all([loadReportImage(brand.company?.logoUrl ?? null), loadReportImage(brand.watermark.imageUrl)]);
  let y = 0;
  const startPage = () => {
    drawReportPdfWatermark(doc, pageWidth, pageHeight, brand.watermark, watermark);
    y = drawReportPdfHeader({doc, pageWidth, margin, orientation:'landscape', settings:brand.header, company:brand.company, logo, title}) + 7;
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(82,103,83);
    doc.text(`${reportPeriod(data.kind, month)} · ${data.total} registros`, margin, y); y += 9;
  };
  const tableHeader = () => {
    let x = margin;
    doc.setFillColor(237,244,232); doc.rect(margin,y,contentWidth,10,'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(63,91,56);
    columns.forEach((column,index) => {doc.text(doc.splitTextToSize(column.label,widths[index]-4),x+2,y+5);x+=widths[index];});
    y += 10;
  };
  startPage();
  const metrics = reportMetricColumns[data.kind];
  const metricWidth = contentWidth / metrics.length;
  metrics.forEach((metric, index) => {
    const x = margin + index * metricWidth;
    doc.setFontSize(8);doc.setFont('helvetica','normal');doc.text(metric.label,x+2,y);
    doc.setFontSize(10);doc.setFont('helvetica','bold');
    doc.text(doc.splitTextToSize(reportCell(data.totals[metric.key],metric),metricWidth-4),x+2,y+6);
  });
  y += 18;
  if (data.totals.billingPending === true) {
    doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(136,101,48);
    doc.text('Valores a apurar: existem contratos com ATR medido ou cotação pendente.',margin,y); y += 8;
  }
  tableHeader();
  for (const row of data.rows) {
    doc.setFont('helvetica','normal');doc.setFontSize(8);
    const cells: string[][] = columns.map((column,index) => doc.splitTextToSize(reportCell(row[column.key],column),widths[index]-4));
    const lineCount = Math.max(...cells.map(lines=>lines.length));
    let offset = 0;
    while (offset < lineCount) {
      if (bottom-y < 9) {doc.addPage();startPage();tableHeader();}
      const available = Math.max(1,Math.floor((bottom-y-4)/3.7));
      const take = Math.min(available,lineCount-offset), height = take*3.7+5;
      let x = margin;
      doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(60,79,57);
      cells.forEach((lines,index)=>{const visible=lines.slice(offset,offset+take);if(visible.length)doc.text(visible,x+2,y+5,{lineHeightFactor:1.3});x+=widths[index];});
      y += height; doc.setDrawColor(229,235,225);doc.line(margin,y,pageWidth-margin,y);offset+=take;
    }
  }
  if (!data.rows.length) {doc.setFont('helvetica','normal');doc.text('Nenhum registro encontrado.',margin+2,y+8);}
  const pageCount = doc.getNumberOfPages();
  for (let page=1;page<=pageCount;page++) {
    doc.setPage(page);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(117,130,107);
    const emitted=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(brand.issuedAt);
    doc.text(doc.splitTextToSize(`Emitido por ${brand.issuer.name} · ${emitted}`,contentWidth-35)[0],margin,pageHeight-margin);
    doc.text(`${page} / ${pageCount}`,pageWidth-margin,pageHeight-margin,{align:'right'});
  }
  return {doc,fileName:`relatorio-${data.kind}-${['farms','contracts'].includes(data.kind)?brand.issuedAt.toISOString().slice(0,10):month}.pdf`};
}
