import {drawReportPdfWatermark,REPORT_MARGIN_MM,type ReportPdfBrand} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {dateLabel} from '@/shared/utils/presentation';
import type {OvertimeReport} from '../types';

export async function createOvertimePdf(report:OvertimeReport,brand:ReportPdfBrand){
 const {jsPDF}=await import('@/shared/reporting/jsPdfRuntime');
 const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
 const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight(),margin=REPORT_MARGIN_MM;
 const content=width-margin*2,bodyBottom=height-margin-30;
 const [logo,watermark]=await Promise.all([loadReportImage(brand.company?.logoUrl??null),loadReportImage(brand.watermark.imageUrl)]);
 const widths=[content*.09,content*.33,content*.26,content*.16,content*.16];
 const edges=[margin];for(const value of widths)edges.push(edges[edges.length-1]+value);
 const month=report.referenceMonth.split('-').reverse().join('/');
 const frame=(x:number,y:number,w:number,h:number)=>{doc.setDrawColor('#222222');doc.setLineWidth(.2);doc.rect(x,y,w,h);};
 const cell=(text:string,x:number,y:number,w:number,h:number,{bold=false,size=9,align='center' as 'left'|'center'|'right',fill=''}={})=>{
  if(fill){doc.setFillColor(fill);doc.rect(x,y,w,h,'F');}
  frame(x,y,w,h);doc.setFont('times',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor('#111111');
  const lines=doc.splitTextToSize(text,Math.max(1,w-3)) as string[];
  const lineHeight=size*.3528*1.15;
  const baseline=y+(h-lines.length*lineHeight)/2+lineHeight*.8;
  doc.text(lines,align==='left'?x+1.5:align==='right'?x+w-1.5:x+w/2,baseline,{align,lineHeightFactor:1.15});
 };
 const header=()=>{
  drawReportPdfWatermark(doc,width,height,brand.watermark,watermark);
  let y=margin;const headerHeight=18,brandWidth=content*.23;
  frame(margin,y,content,headerHeight);
  if(logo){const w=Math.min(brandWidth-6,16*logo.ratio),h=w/logo.ratio;doc.addImage(logo.bytes,logo.format,margin+3,y+(headerHeight-h)/2,w,h,undefined,'FAST');}
  else{doc.setFont('helvetica','bolditalic');doc.setFontSize(11);doc.setTextColor('#166939');doc.text(doc.splitTextToSize(brand.company?.name||'Empresa',brandWidth-6),margin+3,y+8);}
  doc.setFont('times','bold');doc.setFontSize(10);doc.setTextColor('#111111');
  const title='RELATÓRIO DE HORAS-EXTRAS REALIZADAS - SETOR: '+(report.sector||'________________');
  const lines=doc.splitTextToSize(title,content-brandWidth-6) as string[];
  doc.text(lines,margin+brandWidth+(content-brandWidth)/2,y+headerHeight/2-(lines.length-1)*1.8,{align:'center'});
  y+=headerHeight;
  cell('PERÍODO '+dateLabel(report.dateFrom)+' A '+dateLabel(report.dateTo),margin,y,content*.42,8,{bold:true,size:10});
  cell('MÊS '+month,margin+content*.42,y,content*.58,8,{bold:true,size:11});y+=8;
  cell('Mat.',edges[0],y,widths[0],11,{bold:true});
  cell('Funcionário',edges[1],y,widths[1],11,{bold:true});
  cell('Cargo',edges[2],y,widths[2],11,{bold:true});
  cell('QUANTIDADE HORAS EXTRAS',edges[3],y,widths[3]+widths[4],5.5,{size:9});
  cell('50%',edges[3],y+5.5,widths[3],5.5,{bold:true,fill:'#fff600'});
  cell('100%',edges[4],y+5.5,widths[4],5.5,{bold:true,fill:'#fff600'});
  return y+11;
 };
 let y=header(),rowsOnPage=0;
 const row=(values:string[],rowHeight:number)=>{for(let i=0;i<values.length;i++)cell(values[i],edges[i],y,widths[i],rowHeight,{size:9});y+=rowHeight;rowsOnPage++;};
 for(const item of report.rows){
  const values=[item.registrationNumber,item.employeeName.toLocaleUpperCase('pt-BR'),item.jobTitle.toLocaleUpperCase('pt-BR'),item.hours50==='00:00:00'?'':item.hours50,item.hours100==='00:00:00'?'':item.hours100];
  doc.setFont('times','normal');doc.setFontSize(9);
  const rowHeight=Math.max(6,...values.map((value,i)=>doc.splitTextToSize(value,widths[i]-3).length*3.7+2));
  if(y+rowHeight+9>bodyBottom){doc.addPage();y=header();rowsOnPage=0;}
  row(values,rowHeight);
 }
 while(rowsOnPage<20&&y+6+9<=bodyBottom)row(['','','','',''],6);
 if(y+9>bodyBottom){doc.addPage();y=header();}
 cell('TOTAL DE HORAS',margin,y,widths[0]+widths[1]+widths[2],8,{align:'right',size:10});
 cell(report.total50,edges[3],y,widths[3],8,{bold:true,size:10});
 cell(report.total100,edges[4],y,widths[4],8,{bold:true,size:10});y+=8;
 const signatureY=Math.max(y+18,height-margin-12),signatureWidth=content*.3;
 doc.setDrawColor('#222222');doc.setLineWidth(.2);
 doc.line(margin+content*.07,signatureY,margin+content*.07+signatureWidth,signatureY);
 doc.line(margin+content*.63,signatureY,margin+content*.63+signatureWidth,signatureY);
 doc.setFont('times','normal');doc.setFontSize(9);doc.text('COORD. DO SETOR',margin+content*.22,signatureY+5,{align:'center'});
 doc.text('DIRETOR DA UNIDADE',margin+content*.78,signatureY+5,{align:'center'});
 const pages=doc.getNumberOfPages();
 for(let page=1;page<=pages;page++){doc.setPage(page);doc.setFont('helvetica','normal');doc.setFontSize(6);doc.setTextColor('#7b887f');doc.text('Relatório de horas extras · '+page+' / '+pages,width-margin,height-6,{align:'right'});}
 return {doc,fileName:'relatorio-horas-extras-'+report.dateFrom+'-a-'+report.dateTo+'.pdf'};
}
