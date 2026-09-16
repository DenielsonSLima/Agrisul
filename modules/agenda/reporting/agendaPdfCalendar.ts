import type {jsPDF} from 'jspdf';
import {agendaKinds, type AgendaData, type AgendaKind} from '../types';
import {agendaColors} from '../utils/agendaPresentation';

type CalendarOptions = {doc:jsPDF;data:AgendaData;kind:AgendaKind|'';margin:number;width:number;top:number;bottom:number};

export function drawAgendaPdfCalendar({doc,data,kind,margin,width,top,bottom}: CalendarOptions) {
  const content = width - margin * 2, legendColumn = content / 3;
  doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor('#53674a'); doc.text('Legenda',margin,top);
  agendaKinds.forEach((item,index) => {
    const x = margin + index % 3 * legendColumn, y = top + 4 + Math.floor(index / 3) * 4;
    doc.setFillColor(agendaColors[item.id]); doc.circle(x + 1,y - .8,.7,'F');
    doc.setFont('helvetica',kind === item.id ? 'bold' : 'normal'); doc.setFontSize(7);
    doc.text(item.label,x + 3.5,y);
  });
  const gridTop = top + 12, weekdayHeight = 5, cellWidth = content / 7;
  const firstColumn = (data.days[0]?.gridColumn ?? 1) - 1;
  const weeks = Math.max(1,Math.ceil((firstColumn + data.days.length) / 7));
  const rowHeight = (bottom - gridTop - weekdayHeight) / weeks;
  doc.setFillColor('#f3f7ee'); doc.rect(margin,gridTop,content,weekdayHeight,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor('#52674a');
  ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].forEach((day,column) => doc.text(day,margin + column * cellWidth + cellWidth / 2,gridTop + 3.5,{align:'center'}));
  data.days.forEach((day,index) => {
    const position = firstColumn + index, column = position % 7, week = Math.floor(position / 7);
    const x = margin + column * cellWidth, y = gridTop + weekdayHeight + week * rowHeight;
    doc.setDrawColor('#dce5d6'); doc.setLineWidth(.2); doc.rect(x,y,cellWidth,rowHeight);
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor('#344e34');
    doc.text(String(day.dayNumber).padStart(2,'0'),x + 1.8,y + 3.5);
    doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(day.eventCount ? '#526753' : '#9aa391');
    const label = day.eventCount ? `${day.eventCount} evento${day.eventCount === 1 ? '' : 's'}` : 'Sem registros';
    doc.text(label,x + 1.8,y + 7);
    day.kinds.forEach((eventKind,kindIndex) => {
      doc.setFillColor(agendaColors[eventKind]); doc.circle(x + 2.5 + kindIndex * 3.2,y + rowHeight - 2,.65,'F');
    });
  });
}
