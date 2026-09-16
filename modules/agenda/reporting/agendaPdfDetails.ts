import type {jsPDF} from 'jspdf';
import {dateLabel, decimalLabel, moneyLabel} from '@/shared/utils/presentation';
import type {AgendaData, AgendaDay, AgendaEvent} from '../types';
import {agendaColors, agendaSummaryLabel, agendaSummaryValue} from '../utils/agendaPresentation';

type DetailsOptions = {doc:jsPDF;data:AgendaData;margin:number;width:number;top:number;bottom:number;continuationTop:number;newPage:()=>number};
type TextStyle = {size?:number;bold?:boolean;color?:string;indent?:number};

export function drawAgendaPdfDetails({doc,data,margin,width,top,bottom,continuationTop,newPage}: DetailsOptions) {
  const content = width - margin * 2, bodySize = 8.5, bodyStep = bodySize * .45;
  let y = top, currentDay: AgendaDay | null = null, currentEvent: AgendaEvent | null = null;
  function section(continued = false) {
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor('#344e34');
    doc.text(`Detalhes do mês${continued ? ' · continuação' : ''}`,margin,y); y += 6;
  }
  function dayHeading(day: AgendaDay, continued = false) {
    doc.setFillColor('#f3f7ee'); doc.rect(margin,y,content,7,'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor('#344e34');
    doc.text(`${dateLabel(day.date)}${continued ? ' · continuação' : ''}`,margin + 2,y + 4.6);
    doc.setFont('helvetica','normal'); doc.setFontSize(8);
    doc.text(`${day.eventCount} evento${day.eventCount === 1 ? '' : 's'}`,width - margin - 2,y + 4.6,{align:'right'});
    y += 11;
  }
  function nextPage() {
    y = newPage(); section(true);
    if (currentDay) dayHeading(currentDay,true);
    if (currentEvent) {
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(agendaColors[currentEvent.kind]);
      const reference = currentEvent.contractNumber ? `Contrato ${currentEvent.contractNumber}` : currentEvent.title;
      const line: string = doc.splitTextToSize(reference,content - 38)[0];
      doc.text(`${line} · evento em continuação`,margin + 2,y); y += bodyStep + 1;
    }
  }
  function ensureSpace(space: number) {if (y + space > bottom) nextPage();}
  function linesFor(text: string, {size = bodySize,bold = false,indent = 2}: TextStyle = {}): string[] {
    doc.setFont('helvetica',bold ? 'bold' : 'normal'); doc.setFontSize(size);
    return doc.splitTextToSize(text,content - indent - 2);
  }
  function write(text: string, style: TextStyle = {}) {
    const {size = bodySize,bold = false,color = '#526753',indent = 2} = style;
    const lines = linesFor(text,style), step = size * .45;
    for (const line of lines) {
      ensureSpace(step);
      doc.setFont('helvetica',bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color);
      doc.text(line,margin + indent,y); y += step;
    }
  }
  function prepareEvent(event: AgendaEvent) {
    const title = [event.title,event.contractNumber ? `Contrato ${event.contractNumber}` : ''].filter(Boolean).join(' · ');
    const values = [event.status,event.volume ? `${decimalLabel(event.volume)} t` : '',event.amount ? moneyLabel(event.amount) : ''].filter(Boolean).join(' · ');
    const height = linesFor(title,{bold:true}).length * bodyStep
      + (event.detail ? linesFor(event.detail).length * bodyStep : 0)
      + (values ? linesFor(values,{size:8}).length * 3.6 : 0) + 2;
    const pageCapacity = bottom - continuationTop - 17;
    return {event,title,values,requiredSpace:height <= Math.min(pageCapacity,32) ? height : bodyStep * 3};
  }
  section();
  const days = data.days.filter(day => day.summary.length || day.events.length);
  if (!days.length) {write('Nenhum evento no mês para o filtro selecionado.'); return;}
  for (const day of days) {
    const events = day.events.map(prepareEvent);
    const firstContent = !day.summary.length && events.length ? events[0].requiredSpace : bodyStep * 2;
    currentDay = null; ensureSpace(11 + firstContent); currentDay = day; dayHeading(day);
    for (const item of day.summary) {
      const value = agendaSummaryValue(item);
      write(`${agendaSummaryLabel(item)}${value ? ' · ' + value : ''}`,{size:8,color:agendaColors[item.kind]});
    }
    if (day.summary.length && day.events.length) y += 2;
    for (const {event,title,values,requiredSpace} of events) {
      // Keep small events together. Long events use the remaining space and
      // continue line by line, with date and event identification repeated.
      ensureSpace(requiredSpace);
      currentEvent = event;
      write(title,{bold:true,color:agendaColors[event.kind]});
      if (event.detail) write(event.detail);
      if (values) write(values,{size:8});
      currentEvent = null; y += 2;
    }
    y += 3;
  }
}
