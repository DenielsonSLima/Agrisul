import type {jsPDF as JsPdf} from 'jspdf';
import {drawReportPdfHeader,drawReportPdfWatermark,REPORT_MARGIN_MM,type ReportPdfBrand} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {dateLabel,decimalLabel,monthLabel} from '@/shared/utils/presentation';
import type {PlanningExportSnapshot} from '../types';

type Column={label:string;width:number;align?:'left'|'right'};
const kindLabel={planting:'Plantio',management:'Manejo / trato cultural',loss:'Perda / área morta'} as const;
const short=(doc:JsPdf,value:string,width:number)=>doc.splitTextToSize(value||'—',Math.max(1,width))[0]??'—';
const safeName=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'safra';

export async function createPlanningDiaryPdf(snapshot:PlanningExportSnapshot,brand:ReportPdfBrand){
 const {jsPDF}=await import('@/shared/reporting/jsPdfRuntime');
 const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
 const {data,period}=snapshot;const summary=data.diaryPeriodSummary;const margin=REPORT_MARGIN_MM,width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight();
 const content=width-margin*2,bottom=height-margin-9;
 const [logo,watermark]=await Promise.all([loadReportImage(brand.company?.logoUrl??null),loadReportImage(brand.watermark.imageUrl)]);
 let y=0,currentSection='Posição do Diário';
 const pageHeader=(section:string)=>{
  drawReportPdfWatermark(doc,width,height,brand.watermark,watermark);
  const line=drawReportPdfHeader({doc,pageWidth:width,margin,orientation:'landscape',settings:brand.header,company:brand.company,logo,title:'Diário de campo'});
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor('#344e3b');doc.text(short(doc,period.name,content*.6),margin,line+7);
  doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor('#708076');
  doc.text(`${dateLabel(period.startDate)} a ${dateLabel(period.endDate)} · ${period.cultureName} · ${period.cultureSubtypeName}`,margin,line+12);
  doc.setFont('helvetica','bold');doc.setTextColor('#55705e');doc.text(`Período filtrado: ${dateLabel(summary.dateFrom)} a ${dateLabel(summary.dateTo)}`,margin,line+16);
  doc.setFont('helvetica','bold');doc.setTextColor('#55705e');doc.text(section,width-margin,line+9,{align:'right'});
  return line+22;
 };
 const newPage=(section:string)=>{doc.addPage();currentSection=section;y=pageHeader(section);};
 const ensure=(space:number,section=currentSection)=>{if(y+space>bottom)newPage(section);};
 const sectionTitle=(title:string)=>{ensure(12,title);currentSection=title;doc.setFillColor('#eef5f0');doc.roundedRect(margin,y,content,8,1.2,1.2,'F');doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor('#3f654c');doc.text(title,margin+3,y+5.3);y+=11;};
 const table=(title:string,columns:Column[],rows:string[][])=>{
  sectionTitle(title);const head=8,rowHeight=8;
  const drawHead=()=>{doc.setFillColor('#f4f7f5');doc.rect(margin,y,content,head,'F');doc.setFont('helvetica','bold');doc.setFontSize(7);doc.setTextColor('#66786c');let x=margin;columns.forEach(column=>{doc.text(column.label,column.align==='right'?x+column.width-2:x+2,y+5.2,{align:column.align??'left'});x+=column.width;});y+=head;};
  if(!rows.length){doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor('#839188');doc.text('Nenhum movimento registrado nesta seção.',margin+2,y+5);y+=9;return;}
  ensure(head+rowHeight,title);drawHead();
  rows.forEach((row,index)=>{if(y+rowHeight>bottom){newPage(title);drawHead();}if(index%2){doc.setFillColor('#fafcfb');doc.rect(margin,y,content,rowHeight,'F');}doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor('#4f6256');let x=margin;row.forEach((value,columnIndex)=>{const column=columns[columnIndex];doc.text(short(doc,value,column.width-4),column.align==='right'?x+column.width-2:x+2,y+5.2,{align:column.align??'left'});x+=column.width;});doc.setDrawColor('#edf1ee');doc.line(margin,y+rowHeight,width-margin,y+rowHeight);y+=rowHeight;});
  y+=3;
 };

 const fieldLogs=data.fieldLogs.filter(item=>!item.voidedAt).sort((a,b)=>b.occurredOn.localeCompare(a.occurredOn)||b.createdAt.localeCompare(a.createdAt));
 const harvestLoads=[...data.harvestLoads].sort((a,b)=>b.loadedAt.localeCompare(a.loadedAt)||b.id.localeCompare(a.id));
 y=pageHeader('Posição do Diário');
 const metrics=[['Plantio no período',`${decimalLabel(summary.plantedAreaHa)} ha`],['Manejo / tratos',`${decimalLabel(summary.managedAreaHa)} ha`],['Perdas registradas',`${decimalLabel(summary.lostAreaHa)} ha`],['Colheita carregada',`${decimalLabel(summary.harvestedTons)} t`],['Apontamentos de campo',String(summary.fieldLogCount)],['Carregamentos',String(summary.loadCount)]];
 const gap=3,box=(content-gap*(metrics.length-1))/metrics.length;
 metrics.forEach(([label,value],index)=>{const x=margin+index*(box+gap);if(index===1||index===3)doc.setFillColor(238,248,241);else doc.setFillColor(246,249,247);doc.roundedRect(x,y,box,16,1.5,1.5,'F');doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor('#7b8c80');doc.text(label,x+2.5,y+5);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor('#365743');doc.text(short(doc,value,box-5),x+2.5,y+11.5);});y+=21;

 table('Posição por dia — realizado / acumulado',[{label:'Dia',width:45},{label:'Plantio',width:45},{label:'Manejo / tratos',width:45},{label:'Perdas',width:45},{label:'Colheita',width:45},{label:'Cargas',width:44}],data.dailySummary.map(item=>[dateLabel(item.date),`${decimalLabel(item.plantedAreaHa)} / ${decimalLabel(item.accumulatedPlantedAreaHa)} ha`,`${decimalLabel(item.managedAreaHa)} / ${decimalLabel(item.accumulatedManagedAreaHa)} ha`,`${decimalLabel(item.lostAreaHa)} / ${decimalLabel(item.accumulatedLostAreaHa)} ha`,`${decimalLabel(item.harvestedTons)} / ${decimalLabel(item.accumulatedHarvestedTons)} t`,`${item.loadCount} / ${item.accumulatedLoadCount}`]));
 table('Posição por mês — realizado / acumulado',[{label:'Mês',width:45},{label:'Plantio',width:45},{label:'Manejo / tratos',width:45},{label:'Perdas',width:45},{label:'Colheita',width:45},{label:'Cargas',width:44}],data.monthlySummary.map(item=>[monthLabel(item.month),`${decimalLabel(item.plantedAreaHa)} / ${decimalLabel(item.accumulatedPlantedAreaHa)} ha`,`${decimalLabel(item.managedAreaHa)} / ${decimalLabel(item.accumulatedManagedAreaHa)} ha`,`${decimalLabel(item.lostAreaHa)} / ${decimalLabel(item.accumulatedLostAreaHa)} ha`,`${decimalLabel(item.harvestedTons)} / ${decimalLabel(item.accumulatedHarvestedTons)} t`,`${item.loadCount} / ${item.accumulatedLoadCount}`]));
 table('Apontamentos de campo',[{label:'Data',width:22},{label:'Tipo',width:30},{label:'Manejo / serviço',width:43},{label:'Fazenda',width:37},{label:'Talhão',width:29},{label:'Área',width:21,align:'right'},{label:'Responsável',width:34},{label:'Observações',width:53}],fieldLogs.map(item=>[dateLabel(item.occurredOn),kindLabel[item.kind],item.practiceName||'—',item.farmName,item.plotName,`${decimalLabel(item.areaHa)} ha`,item.details?.responsibleName||item.createdByName||'Usuário',item.notes||'—']));
 const bulletinRows=fieldLogs.filter(item=>{const detail=item.details;return detail&&Object.entries(detail).some(([key,value])=>key!=='materials'&&!!value);}).map(item=>{const detail=item.details;return [dateLabel(item.occurredOn),detail.operatorName||'—',detail.shift||'—',[detail.startedAt,detail.endedAt].filter(Boolean).join('–')||'—',[detail.equipmentCode,detail.equipmentDescription].filter(Boolean).join(' · ')||'—',[detail.implementCode,detail.implementDescription].filter(Boolean).join(' · ')||'—',[detail.hourMeterStart,detail.hourMeterEnd].filter(Boolean).join(' → ')||'—',[detail.applicationNumber&&`Ap. ${detail.applicationNumber}`,detail.serviceOrderNumber&&`OS ${detail.serviceOrderNumber}`,detail.applicationServiceOrderNumber&&`Ap.OS ${detail.applicationServiceOrderNumber}`].filter(Boolean).join(' · ')||'—'];});
 table('Máquinas, equipes e ordens',[{label:'Data',width:22},{label:'Operador',width:36},{label:'Turno',width:20},{label:'Horário',width:30},{label:'Equipamento',width:50},{label:'Implemento',width:40},{label:'Horímetro',width:35},{label:'Ordens',width:36}],bulletinRows);
 const materialRows=fieldLogs.flatMap(item=>(item.details?.materials??[]).map(material=>[dateLabel(item.occurredOn),item.farmName,item.plotName,item.practiceName||kindLabel[item.kind],material.code||'—',material.description,`${material.quantity||'—'}${material.unit?' '+material.unit:''}`,material.recommendedDose||'—']));
 table('Materiais e insumos aplicados',[{label:'Data',width:22},{label:'Fazenda',width:40},{label:'Talhão',width:30},{label:'Serviço',width:45},{label:'Código',width:22},{label:'Material',width:45},{label:'Quantidade',width:25,align:'right'},{label:'Dose',width:40}],materialRows);
 table('Carregamentos da colheita',[{label:'Data',width:24},{label:'Fazenda',width:46},{label:'Talhão',width:38},{label:'Quantidade',width:30,align:'right'},{label:'Contrato',width:35},{label:'Documento',width:40},{label:'Observações',width:56}],harvestLoads.map(item=>[dateLabel(item.loadedAt),item.farmName,item.plotName,`${decimalLabel(item.volumeTons)} t`,item.contractNumber||'Sem número',item.document||'—',item.notes||'—']));

 const pages=doc.getNumberOfPages(),emitted=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(brand.issuedAt);
 for(let page=1;page<=pages;page++){doc.setPage(page);doc.setDrawColor('#e5ebe7');doc.line(margin,height-margin-4,width-margin,height-margin-4);doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor('#7f8f84');doc.text(short(doc,`Emitido por ${brand.issuer.name||brand.issuer.email} · ${emitted}`,content-25),margin,height-margin);doc.text(`${page} / ${pages}`,width-margin,height-margin,{align:'right'});}
 return {doc,fileName:`diario-de-campo-${safeName(period.name)}.pdf`};
}
