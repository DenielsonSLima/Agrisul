import {drawReportPdfWatermark,REPORT_MARGIN_MM,type ReportPdfBrand} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {dateLabel} from '@/shared/utils/presentation';
import type {OvertimeReport,OvertimeRow} from '../types';
import {dailyClockLabel,dailyHoursLabel,dailyOvertimeCalendar,dailyReasonLabel} from './dailyOvertimePresentation';

export async function createDailyOvertimePdf(report:OvertimeReport,row:OvertimeRow,brand:ReportPdfBrand){
 const {jsPDF}=await import('@/shared/reporting/jsPdfRuntime');
 const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
 const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight(),margin=REPORT_MARGIN_MM;
 const content=width-margin*2,bodyBottom=height-margin-8;
 const watermark=await loadReportImage(brand.watermark.imageUrl);
 const widths=[.045,.08,.08,.08,.08,.09,.09,.33,.125].map(fraction=>fraction*content);
 const edges=[margin];for(const value of widths)edges.push(edges[edges.length-1]+value);
 const daily=row.daily;
 const wrap=(text:string,width:number,size=7.5,bold=false)=>{doc.setFont('times',bold?'bold':'normal');doc.setFontSize(size);return doc.splitTextToSize(text,Math.max(1,width-2.2)) as string[];};
 const frame=(x:number,y:number,w:number,h:number)=>{doc.setDrawColor('#222222');doc.setLineWidth(.18);doc.rect(x,y,w,h);};
 const cell=(text:string,x:number,y:number,w:number,h:number,{bold=false,size=7.5,align='center' as 'left'|'center'|'right',fill=''}={})=>{
  if(fill){doc.setFillColor(fill);doc.rect(x,y,w,h,'F');}frame(x,y,w,h);
  const lines=wrap(text,w,size,bold),lineHeight=size*.3528*1.12;
  doc.setFont('times',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor('#111111');
  doc.text(lines,align==='left'?x+1.1:align==='right'?x+w-1.1:x+w/2,y+(h-lines.length*lineHeight)/2+lineHeight*.8,{align,lineHeightFactor:1.12});
 };
 const fullLine=(text:string,y:number,size=9,bold=true)=>{
  const h=Math.max(7,wrap(text,content,size,bold).length*size*.3528*1.12+2);
  cell(text,margin,y,content,h,{bold,size,align:'left'});return y+h;
 };
 const header=()=>{
  drawReportPdfWatermark(doc,width,height,brand.watermark,watermark);
  let y=margin;cell('INFORMATIVO DE HORAS EXTRAS',margin,y,content,9,{bold:true,size:11});y+=9;
  y=fullLine('PERÍODO: '+dateLabel(report.dateFrom)+' A '+dateLabel(report.dateTo),y);
  y=fullLine('FUNCIONÁRIO: '+row.employeeName.toLocaleUpperCase('pt-BR')+'    MATRÍCULA: '+row.registrationNumber,y);
  y=fullLine('ATIVIDADE: '+(daily?.activity||'____________________________')+'    SETOR: '+(daily?.sector||report.sector||'____________________'),y,8);
  cell('DIA',edges[0],y,widths[0],11,{bold:true});
  cell('HORA',edges[1],y,widths[1]+widths[2]+widths[3]+widths[4],5.5,{bold:true,size:8});
  cell('TOTAL',edges[5],y,widths[5]+widths[6],5.5,{bold:true,size:8});
  cell('MOTIVO DA HORA EXTRA',edges[7],y,widths[7],11,{bold:true,size:8});
  cell('VISTO',edges[8],y,widths[8],11,{bold:true,size:8});
  for(const [index,title] of ['INICIAL','SAÍDA','ENTRADA','FINAL'].entries())cell(title,edges[index+1],y+5.5,widths[index+1],5.5,{bold:true,size:7});
  cell('50%',edges[5],y+5.5,widths[5],5.5,{bold:true,fill:'#fff600'});
  cell('100%',edges[6],y+5.5,widths[6],5.5,{bold:true,fill:'#fff600'});
  return y+11;
 };
 let y=header();const pageBodyStart=y;
 const nextPage=()=>{doc.addPage();y=header();};
 const tableRow=(values:string[],bold=false)=>{
  const lineSets=values.map((value,index)=>wrap(value,widths[index],7.5,bold)),lineCount=Math.max(1,...lineSets.map(lines=>lines.length));
  // A long reason or approval can span pages without dropping its final lines.
  let offset=0;
  while(offset<lineCount){
   if(y+5.2>bodyBottom)nextPage();
   const fit=Math.max(1,Math.floor((bodyBottom-y-1.6)/3)),count=Math.min(lineCount-offset,fit),rowHeight=Math.max(5.2,count*3+1.6);
   if(rowHeight>bodyBottom-y&&y>pageBodyStart){nextPage();continue;}
   lineSets.forEach((lines,index)=>cell(lines.slice(offset,offset+count).join('\n'),edges[index],y,widths[index],rowHeight,{bold,size:7.5,align:index===7?'left':'center'}));
   y+=rowHeight;offset+=count;
   if(offset<lineCount)nextPage();
  }
 };
 for(const {date,entry} of dailyOvertimeCalendar(report.dateFrom,report.dateTo,daily?.entries??[])){
  tableRow([String(Number(date.slice(8))),dailyClockLabel(entry?.startTime),dailyClockLabel(entry?.breakStart),dailyClockLabel(entry?.breakEnd),dailyClockLabel(entry?.endTime),dailyHoursLabel(entry?.hours50),dailyHoursLabel(entry?.hours100),dailyReasonLabel(entry),entry?.approval??'']);
 }
 const note=(text:string)=>{
  const lines=wrap(text,content,8);let offset=0;
  while(offset<lines.length){
   if(y+6>bodyBottom)nextPage();
   const count=Math.max(1,Math.min(lines.length-offset,Math.floor((bodyBottom-y-2)/3.2))),h=count*3.2+2;
   cell(lines.slice(offset,offset+count).join('\n'),margin,y,content,h,{size:8,align:'left'});y+=h;offset+=count;
  }
 };
 if(daily?.adjustment){
  note('AJUSTE DO RESUMO: 50% '+daily.adjustment.hours50+' | 100% '+daily.adjustment.hours100+' — Motivo: '+daily.adjustment.reason);
 }
 if(row.source==='legacy'&&!daily?.hasDailyEntries)note('Resumo anterior preservado. Este funcionário ainda não possui lançamentos diários neste período.');
 if(y+8>bodyBottom)nextPage();
 cell('TOTAL DE HORAS',margin,y,widths.slice(0,5).reduce((sum,value)=>sum+value,0),8,{bold:true,size:8,align:'right'});
 cell(row.hours50,edges[5],y,widths[5],8,{bold:true,size:8});cell(row.hours100,edges[6],y,widths[6],8,{bold:true,size:8});
 cell('',edges[7],y,widths[7]+widths[8],8);y+=8;
 const pages=doc.getNumberOfPages();
 for(let page=1;page<=pages;page++){
  doc.setPage(page);doc.setFont('helvetica','normal');doc.setFontSize(6);doc.setTextColor('#7b887f');
  doc.text('Informativo de horas extras · '+page+' / '+pages,width-margin,height-6,{align:'right'});
 }
 const employee=row.employeeName.replace(/[<>:"/\\|?*\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim()||'Funcionário';
 return {doc,fileName:'Horas extras - '+employee+' - '+dateLabel(report.dateFrom).replaceAll('/','-')+' a '+dateLabel(report.dateTo).replaceAll('/','-')+'.pdf'};
}
