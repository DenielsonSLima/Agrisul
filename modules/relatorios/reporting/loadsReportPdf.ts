import {drawReportPdfHeader,drawReportPdfWatermark,REPORT_MARGIN_MM} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {dateLabel,decimalLabel,moneyLabel,monthLabel} from '@/shared/utils/presentation';
import {reportMetricColumns} from '../catalog';
import {reportCell,reportPeriod} from './reportPresentation';
import type {LoadReportGroup,LoadReportRow,ReportBrand,ReportSnapshot} from '../types';

// Arithmetic in this file is limited to PDF geometry; all business values come from the RPC.
export async function createLoadsReportPdf(snapshot:ReportSnapshot,brand:ReportBrand){
  if(snapshot.data.kind!=='loads')throw new Error('Relatório de carregamentos inválido.');
  const data=snapshot.data;
  const {jsPDF}=await import('@/shared/reporting/jsPdfRuntime');
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
  const margin=REPORT_MARGIN_MM,pageWidth=doc.internal.pageSize.getWidth(),pageHeight=doc.internal.pageSize.getHeight();
  const contentWidth=pageWidth-margin*2,bottom=pageHeight-margin-10;
  const units=[27,53,32,28,43,41,43],totalUnits=units.reduce((sum,item)=>sum+item,0),widths=units.map(item=>item/totalUnits*contentWidth);
  const [logo,watermark]=await Promise.all([loadReportImage(brand.company?.logoUrl??null),loadReportImage(brand.watermark.imageUrl)]);
  let y=0;
  const startPage=()=>{
    drawReportPdfWatermark(doc,pageWidth,pageHeight,brand.watermark,watermark);
    y=drawReportPdfHeader({doc,pageWidth,margin,orientation:'landscape',settings:brand.header,company:brand.company,logo,title:'Carregamentos'})+7;
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(82,103,83);
    const criteria=doc.splitTextToSize(`${reportPeriod('loads',snapshot.month,data.filters)} · ${data.total} carregamento(s)`,contentWidth);
    doc.text(criteria,margin,y,{lineHeightFactor:1.25});y+=Math.max(9,criteria.length*3.8+4);
  };
  const tableHeader=()=>{
    const labels=['Data / carga','Fazenda','Quantidade (t)','ATR (kg/t)','Faturamento','Descontos','Valor líquido'];let x=margin;
    doc.setFillColor(232,241,226);doc.rect(margin,y,contentWidth,9,'F');doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(54,83,48);
    labels.forEach((label,index)=>{doc.text(label,x+2,y+5.7,index>1?{align:'left'}:undefined);x+=widths[index];});y+=9;
  };
  const contractHeading=(group:LoadReportGroup,continuation=false)=>{
    const label=`${group.clientName} · Contrato ${group.contractNumber||group.contractTitle}${continuation?' · continuação':''}`;
    doc.setFillColor(219,235,210);doc.rect(margin,y,contentWidth,8,'F');doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(36,77,42);
    doc.text(doc.splitTextToSize(label,contentWidth-4)[0],margin+2,y+5.3);y+=8;tableHeader();
  };
  const nextPage=(group?:LoadReportGroup)=>{doc.addPage();startPage();if(group)contractHeading(group,true);};
  const measureLoad=(load:LoadReportRow,index:number)=>{
    const values=[dateLabel(load.loadedAt),load.farmName,decimalLabel(load.volume),decimalLabel(load.atr),moneyLabel(load.grossAmount),moneyLabel(load.discountAmount),moneyLabel(load.netAmount)];
    const cells=values.map((value,column)=>doc.splitTextToSize(value,widths[column]-4));
    const topHeight=Math.max(10,Math.max(...cells.map(lines=>lines.length))*3.4+4);
    const detail=`Carga ${index+1} · ${load.billingPending?'A apurar':'Apurado'} · Talhão: ${load.plotName} · Documento: ${load.document||'—'} · Referência ATR: ${load.atrReferenceMonth?monthLabel(load.atrReferenceMonth):'—'} · Cotação: ${moneyLabel(load.atrQuote)}${load.notes?` · Observações: ${load.notes}`:''}`;
    const detailLines=doc.splitTextToSize(detail,contentWidth-7),detailHeight=Math.max(8,detailLines.length*3.2+4),height=topHeight+detailHeight;
    return {cells,topHeight,detailLines,detailHeight,height};
  };
  const loadBlock=(load:LoadReportRow,index:number,measured=measureLoad(load,index))=>{
    const {cells,topHeight,detailLines,height}=measured;
    doc.setFillColor(index%2?244:255,index%2?248:255,index%2?241:255);doc.rect(margin,y,contentWidth,height,'F');
    doc.setFillColor(index%2?126:73,index%2?159:132,index%2?105:75);doc.rect(margin,y,1.4,height,'F');
    let x=margin;doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(57,77,55);
    cells.forEach((lines,column)=>{doc.text(lines,x+2,y+5,{lineHeightFactor:1.25});x+=widths[column];});
    doc.setDrawColor(220,230,215);doc.line(margin,y+topHeight,pageWidth-margin,y+topHeight);
    doc.setFontSize(7);doc.setTextColor(load.billingPending?139:83,load.billingPending?98:106,load.billingPending?37:75);
    doc.text(detailLines,margin+3,y+topHeight+4.2,{lineHeightFactor:1.25});y+=height;
    doc.setDrawColor(205,218,199);doc.line(margin,y,pageWidth-margin,y);
  };
  const subtotal=(group:LoadReportGroup)=>{
    const t=group.totals,values=[decimalLabel(t.volume),decimalLabel(t.averageAtr),moneyLabel(t.grossAmount),moneyLabel(t.discountAmount),moneyLabel(t.netAmount)];
    doc.setFillColor(225,238,218);doc.rect(margin,y,contentWidth,10,'F');doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(48,85,49);
    doc.text(`Subtotal do contrato · ${t.loadCount} carga(s)`,margin+2,y+6);
    let x=margin+widths[0]+widths[1];
    values.forEach((value,index)=>{const width=widths[index+2];doc.text(value,x+width-2,y+6,{align:'right'});x+=width;});y+=12;
  };

  startPage();
  const metrics=reportMetricColumns.loads,metricWidth=contentWidth/metrics.length;
  metrics.forEach((metric,index)=>{const x=margin+index*metricWidth;doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(91,111,84);doc.text(metric.label,x+2,y);doc.setFont('helvetica','bold');doc.setFontSize(9.5);doc.setTextColor(54,87,51);doc.text(doc.splitTextToSize(reportCell(data.totals[metric.key],metric),metricWidth-4),x+2,y+6);});
  y+=17;
  if(data.totals.billingPending){doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(139,98,37);doc.text(`${data.totals.pendingLoadCount} carregamento(s) com ATR ou cotação a apurar.`,margin,y);y+=7;}
  for(const group of data.groups){
    doc.setFont('helvetica','normal');doc.setFontSize(7.5);
    const first=group.loads[0]?measureLoad(group.loads[0],0):null;
    if(bottom-y<17+(first?.height??0)+(group.loads.length===1?12:0))nextPage();
    contractHeading(group);
    for(const [index,load] of group.loads.entries()){
      doc.setFont('helvetica','normal');doc.setFontSize(7.5);
      const measured=measureLoad(load,index),required=measured.height+(index===group.loads.length-1?12:0);
      if(bottom-y<required)nextPage(group);
      loadBlock(load,index,measured);
    }
    if(bottom-y<12)nextPage(group);
    subtotal(group);
  }
  if(!data.groups.length){doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(60,79,57);doc.text('Nenhum carregamento encontrado para os filtros aplicados.',margin,y+8);}
  const pages=doc.getNumberOfPages(),emitted=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(brand.issuedAt);
  for(let page=1;page<=pages;page++){doc.setPage(page);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(117,130,107);doc.text(doc.splitTextToSize(`Emitido por ${brand.issuer.name} · ${emitted}`,contentWidth-35)[0],margin,pageHeight-margin);doc.text(`${page} / ${pages}`,pageWidth-margin,pageHeight-margin,{align:'right'});}
  return {doc,fileName:`relatorio-carregamentos-${data.period.from}-a-${data.period.to}.pdf`};
}
