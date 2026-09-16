import type {jsPDF as JsPdf} from 'jspdf';
import {drawReportPdfHeader,drawReportPdfWatermark,REPORT_MARGIN_MM,type ReportPdfBrand} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {dateLabel,decimalLabel,monthLabel} from '@/shared/utils/presentation';
import type {PlanningExportSnapshot} from '../types';

type Column={label:string;width:number;align?:'left'|'right'};
const kindLabel={planting:'Plantio',management:'Manejo',loss:'Perda / área morta'} as const;
const short=(doc:JsPdf,value:string,width:number)=>doc.splitTextToSize(value||'—',Math.max(1,width))[0]??'—';
const safeName=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'safra';

export async function createPlanningPdf(snapshot:PlanningExportSnapshot,brand:ReportPdfBrand){
 const {jsPDF}=await import('jspdf');const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
 const {data,period}=snapshot;const margin=REPORT_MARGIN_MM,width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight();
 const content=width-margin*2,bottom=height-margin-9;
 const [logo,watermark]=await Promise.all([loadReportImage(brand.company?.logoUrl??null),loadReportImage(brand.watermark.imageUrl)]);
 let y=0,currentSection='Visão geral';
 const pageHeader=(section:string)=>{
  drawReportPdfWatermark(doc,width,height,brand.watermark,watermark);
  const line=drawReportPdfHeader({doc,pageWidth:width,margin,orientation:'landscape',settings:brand.header,company:brand.company,logo,title:'Planejamento agrícola'});
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor('#344e3b');doc.text(short(doc,period.name,content*.6),margin,line+7);
  doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor('#708076');
  doc.text(`${dateLabel(period.startDate)} a ${dateLabel(period.endDate)} · ${period.cultureName} · ${period.cultureSubtypeName}`,margin,line+12);
  doc.setFont('helvetica','bold');doc.setTextColor('#55705e');doc.text(section,width-margin,line+9,{align:'right'});
  return line+18;
 };
 const newPage=(section:string)=>{doc.addPage();currentSection=section;y=pageHeader(section);};
 const ensure=(space:number,section=currentSection)=>{if(y+space>bottom)newPage(section);};
 const sectionTitle=(title:string)=>{ensure(12,title);currentSection=title;doc.setFillColor('#eef5f0');doc.roundedRect(margin,y,content,8,1.2,1.2,'F');doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor('#3f654c');doc.text(title,margin+3,y+5.3);y+=11;};
 const table=(title:string,columns:Column[],rows:string[][])=>{
  sectionTitle(title);const head=8,rowHeight=8;
  const drawHead=()=>{doc.setFillColor('#f4f7f5');doc.rect(margin,y,content,head,'F');doc.setFont('helvetica','bold');doc.setFontSize(7);doc.setTextColor('#66786c');let x=margin;columns.forEach(column=>{doc.text(column.label,column.align==='right'?x+column.width-2:x+2,y+5.2,{align:column.align??'left'});x+=column.width;});y+=head;};
  if(!rows.length){doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor('#839188');doc.text('Nenhum registro nesta seção.',margin+2,y+5);y+=9;return;}
  ensure(head+rowHeight,title);drawHead();
  rows.forEach((row,index)=>{if(y+rowHeight>bottom){newPage(title);drawHead();}if(index%2){doc.setFillColor('#fafcfb');doc.rect(margin,y,content,rowHeight,'F');}doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor('#4f6256');let x=margin;row.forEach((value,columnIndex)=>{const column=columns[columnIndex];doc.text(short(doc,value,column.width-4),column.align==='right'?x+column.width-2:x+2,y+5.2,{align:column.align??'left'});x+=column.width;});doc.setDrawColor('#edf1ee');doc.line(margin,y+rowHeight,width-margin,y+rowHeight);y+=rowHeight;});
  y+=3;
 };

 y=pageHeader('Visão geral');
 const metrics=[['Meta de plantio',`${decimalLabel(period.targetAreaHa)} ha`],['Distribuído',`${decimalLabel(period.allocatedAreaHa)} ha`],['Plantado na safra',`${decimalLabel(period.plantedExecutedAreaHa)} ha`],['Saldo a plantar',`${decimalLabel(period.plantingRemainingAreaHa)} ha`],['Meta de colheita',`${decimalLabel(period.harvestTargetTons)} t`],['Colhido',`${decimalLabel(period.harvestActualTons)} t`]];
 const gap=3,box=(content-gap*(metrics.length-1))/metrics.length;metrics.forEach(([label,value],index)=>{const x=margin+index*(box+gap);if(index===2||index===5)doc.setFillColor(238,248,241);else doc.setFillColor(246,249,247);doc.roundedRect(x,y,box,16,1.5,1.5,'F');doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor('#7b8c80');doc.text(label,x+2.5,y+5);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor('#365743');doc.text(short(doc,value,box-5),x+2.5,y+11.5);});y+=21;
 if(period.notes){const notes=doc.splitTextToSize(`Observações: ${period.notes}`,content) as string[];ensure(notes.length*3.5+4);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor('#65776b');doc.text(notes,margin,y);y+=notes.length*3.5+4;}

 const areaRows=data.farms.flatMap(farm=>farm.plots.length?farm.plots.map(plot=>[farm.name,plot.name,`${decimalLabel(plot.areaHa)} ha`,`${decimalLabel(plot.plantedAreaHa)} ha`,`${decimalLabel(plot.allocation?.areaHa??'0')} ha`,`${decimalLabel(plot.allocation?.executedAreaHa??'0')} ha`,plot.allocation?.practiceNames.join(', ')||'—']):[[farm.name,'Sem talhões',`${decimalLabel(farm.totalAreaHa)} ha`,`${decimalLabel(farm.plantedAreaHa)} ha`,`${decimalLabel(farm.plannedAreaHa)} ha`,'—','—']]);
 table('Fazendas, talhões e metas',[{label:'Fazenda',width:46},{label:'Talhão',width:36},{label:'Área física',width:25},{label:'Plantada atual',width:25},{label:'Meta da safra',width:25},{label:'Realizado',width:25},{label:'Manejos planejados',width:87}],areaRows);
 const harvestRows=data.harvestComparison.flatMap(farm=>[[farm.farmName,'Total da fazenda',`${decimalLabel(farm.targetTons)} t`,`${decimalLabel(farm.harvestedTons)} t`,`${decimalLabel(farm.remainingTons)} t`,`${decimalLabel(farm.harvestPercent)}%`,String(farm.harvestLoadCount)],...farm.plots.map(plot=>[farm.farmName,plot.plotName,`${decimalLabel(plot.targetTons)} t`,`${decimalLabel(plot.harvestedTons)} t`,`${decimalLabel(plot.remainingTons)} t`,`${decimalLabel(plot.harvestPercent)}%`,String(plot.harvestLoadCount)])]);
 table('Metas de colheita por fazenda e talhão',[{label:'Fazenda',width:52},{label:'Talhão',width:48},{label:'Meta',width:38},{label:'Colhido',width:38},{label:'Falta',width:38},{label:'Atingimento',width:31},{label:'Cargas',width:24}],harvestRows);
 table('Resumo diário',[{label:'Dia',width:45},{label:'Plantio',width:45},{label:'Manejo',width:45},{label:'Perdas',width:45},{label:'Colheita',width:45},{label:'Cargas',width:44}],data.dailySummary.map(item=>[dateLabel(item.date),`${decimalLabel(item.plantedAreaHa)} ha`,`${decimalLabel(item.managedAreaHa)} ha`,`${decimalLabel(item.lostAreaHa)} ha`,`${decimalLabel(item.harvestedTons)} t`,String(item.loadCount)]));
 table('Resumo mensal',[{label:'Mês',width:45},{label:'Plantio',width:45},{label:'Manejo',width:45},{label:'Perdas',width:45},{label:'Colheita',width:45},{label:'Cargas',width:44}],data.monthlySummary.map(item=>[monthLabel(item.month),`${decimalLabel(item.plantedAreaHa)} ha`,`${decimalLabel(item.managedAreaHa)} ha`,`${decimalLabel(item.lostAreaHa)} ha`,`${decimalLabel(item.harvestedTons)} t`,String(item.loadCount)]));

 const activities=[...data.fieldLogs.map(item=>({date:item.occurredOn,type:kindLabel[item.kind],farm:item.farmName,plot:item.plotName,amount:`${decimalLabel(item.areaHa)} ha`,detail:item.voidedAt?`Anulado: ${item.voidReason}`:[item.practiceName,item.notes].filter(Boolean).join(' · ')||'Sem observações'})),...data.harvestLoads.map(item=>({date:item.loadedAt,type:'Colheita',farm:item.farmName,plot:item.plotName,amount:`${decimalLabel(item.volumeTons)} t`,detail:`Contrato ${item.contractNumber||'sem número'}${item.document?' · '+item.document:''}${item.notes?' · '+item.notes:''}`}))].sort((a,b)=>b.date.localeCompare(a.date));
 table('Diário de campo e carregamentos',[{label:'Data',width:24},{label:'Tipo',width:29},{label:'Fazenda',width:43},{label:'Talhão',width:39},{label:'Quantidade',width:27},{label:'Detalhes',width:107}],activities.map(item=>[dateLabel(item.date),item.type,item.farm,item.plot,item.amount,item.detail]));

 const pages=doc.getNumberOfPages(),emitted=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(brand.issuedAt);
 for(let page=1;page<=pages;page++){doc.setPage(page);doc.setDrawColor('#e5ebe7');doc.line(margin,height-margin-4,width-margin,height-margin-4);doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor('#7f8f84');doc.text(short(doc,`Emitido por ${brand.issuer.name||brand.issuer.email} · ${emitted}`,content-25),margin,height-margin);doc.text(`${page} / ${pages}`,width-margin,height-margin,{align:'right'});}
 return {doc,fileName:`planejamento-${safeName(period.name)}.pdf`};
}
