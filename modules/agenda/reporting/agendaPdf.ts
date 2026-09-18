import {drawReportPdfHeader, drawReportPdfWatermark, REPORT_MARGIN_MM, type ReportPdfBrand} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {monthLabel} from '@/shared/utils/presentation';
import type {AgendaSnapshot} from '../types';
import {agendaFilterLabel} from '../utils/agendaPresentation';
import {drawAgendaPdfCalendar} from './agendaPdfCalendar';
import {drawAgendaPdfDetails} from './agendaPdfDetails';

// Business values are read from the RPC snapshot. The PDF modules only format
// text and calculate page geometry; they never derive totals from event rows.
export async function createAgendaPdf(snapshot: AgendaSnapshot, brand: ReportPdfBrand) {
  const {jsPDF} = await import('@/shared/reporting/jsPdfRuntime');
  const doc = new jsPDF({orientation:'portrait', unit:'mm', format:'a4', compress:true});
  const {data, kind} = snapshot;
  const margin = REPORT_MARGIN_MM, width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight();
  const content = width - margin * 2, bottom = height - margin - 8;
  const [logo, watermark] = await Promise.all([loadReportImage(brand.company?.logoUrl ?? null), loadReportImage(brand.watermark.imageUrl)]);
  function header(title: string) {
    drawReportPdfWatermark(doc, width, height, brand.watermark, watermark);
    const line = drawReportPdfHeader({doc, pageWidth:width, margin, orientation:'portrait', settings:brand.header, company:brand.company, logo, title});
    doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor('#344e34');
    doc.text(monthLabel(data.month),margin,line + 7);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor('#526753');
    doc.text(`${agendaFilterLabel(kind)} · ${data.eventCount} evento${data.eventCount === 1 ? '' : 's'}`,margin,line + 12);
    return line + 17;
  }
  const top = header('Agenda mensal'), calendarBottom = height / 2;
  drawAgendaPdfCalendar({doc,data,kind,margin,width,top,bottom:calendarBottom});
  doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor('#839178');
  doc.text('Cadastro: data de inclusão. Início e término: datas previstas do contrato.',margin,calendarBottom + 4);
  drawAgendaPdfDetails({doc,data,margin,width,top:calendarBottom + 11,bottom,continuationTop:top,
    newPage:() => {doc.addPage(); return header('Agenda · detalhes');},
  });
  const pages = doc.getNumberOfPages();
  const emitted = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(brand.issuedAt);
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor('#839178');
    doc.setDrawColor('#e8ede9'); doc.line(margin,height - margin - 3,width - margin,height - margin - 3);
    doc.text(doc.splitTextToSize(`Emitido por ${brand.issuer.name} · ${emitted}`,content - 20)[0],margin,height - margin);
    doc.text(`${page} / ${pages}`,width - margin,height - margin,{align:'right'});
  }
  return {doc, fileName:`agenda-${data.month}${kind ? '-'+kind : ''}.pdf`};
}
