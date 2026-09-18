import type {jsPDF as JsPdf} from 'jspdf';
import {drawReportPdfHeader,drawReportPdfWatermark,REPORT_MARGIN_MM,type ReportPdfBrand} from '@/shared/reporting';
import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {dateLabel,decimalLabel,moneyLabel,monthLabel} from '@/shared/utils/presentation';
import type {ExecutiveSummaryData,ExecutiveSummaryMonth,ExecutiveSummarySnapshot} from '../types';

type Column={label:string;width:number;align?:'left'|'right'};
type Color=readonly [number,number,number];

const COLOR={
 page:[246,248,247] as Color,white:[255,255,255] as Color,ink:[23,50,38] as Color,deep:[24,60,43] as Color,
 deepLight:[34,82,58] as Color,green:[47,139,104] as Color,greenSoft:[234,244,237] as Color,
 greenPale:[242,247,244] as Color,blue:[36,85,123] as Color,amber:[217,168,78] as Color,
 amberSoft:[255,247,229] as Color,muted:[116,128,120] as Color,line:[224,233,227] as Color,
 grid:[232,238,234] as Color,shadow:[231,236,232] as Color,
};

const fill=(doc:JsPdf,color:Color)=>doc.setFillColor(color[0],color[1],color[2]);
const stroke=(doc:JsPdf,color:Color)=>doc.setDrawColor(color[0],color[1],color[2]);
const textColor=(doc:JsPdf,color:Color)=>doc.setTextColor(color[0],color[1],color[2]);
const safe=(doc:JsPdf,value:string,width:number)=>doc.splitTextToSize(value||'—',Math.max(1,width))[0]??'—';
const numeric=(value:string)=>Number(value)||0;
const clampPercent=(value:string)=>Math.max(0,Math.min(100,numeric(value)));
const compactMoney=(value:number)=>`R$ ${new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value)}`;
const comparison=(value:string)=>value===''?'Sem base de comparação':`${numeric(value)>0?'+':''}${decimalLabel(value)}% vs. período anterior`;

function card(doc:JsPdf,x:number,y:number,width:number,height:number,radius=2){
 fill(doc,COLOR.shadow);doc.roundedRect(x,y+.7,width,height,radius,radius,'F');
 fill(doc,COLOR.white);stroke(doc,COLOR.line);doc.roundedRect(x,y,width,height,radius,radius,'FD');
}

function drawArc(doc:JsPdf,cx:number,cy:number,radius:number,start:number,end:number,color:Color,width:number){
 if(end<=start)return;
 stroke(doc,color);doc.setLineWidth(width);
 const step=3;
 for(let angle=start;angle<end;angle+=step){
  const next=Math.min(end,angle+step),a=angle*Math.PI/180,b=next*Math.PI/180;
  doc.line(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius,cx+Math.cos(b)*radius,cy+Math.sin(b)*radius);
 }
 doc.setLineWidth(.2);
}

function drawTrendChart(doc:JsPdf,rows:ExecutiveSummaryMonth[],x:number,y:number,width:number,height:number){
 const chartX=x+8,chartY=y+19,chartWidth=width-14,chartHeight=height-29,base=chartY+chartHeight;
 const values=rows.flatMap(item=>[item.billingPending?0:numeric(item.grossAmount),item.billingPending?0:numeric(item.netAmount),numeric(item.receivedAmount)]);
 const maximum=Math.max(...values,1),groups=Math.max(rows.length,1),groupWidth=chartWidth/groups,barWidth=Math.min(3.4,groupWidth*.24);
 doc.setFont('helvetica','normal');doc.setFontSize(5.3);textColor(doc,COLOR.muted);
 for(let index=0;index<=3;index++){
  const ratio=index/3,lineY=base-chartHeight*ratio;stroke(doc,COLOR.grid);doc.setLineDashPattern([1.2,1.4],0);doc.line(chartX,lineY,chartX+chartWidth,lineY);
  doc.text(compactMoney(maximum*ratio),chartX-1.5,lineY+1.4,{align:'right'});
 }
 doc.setLineDashPattern([],0);
 const receivedPoints:{x:number;y:number}[]=[];
 rows.forEach((item,index)=>{
  const center=chartX+groupWidth*(index+.5),gross=item.billingPending?0:numeric(item.grossAmount),net=item.billingPending?0:numeric(item.netAmount),received=numeric(item.receivedAmount);
  const series=[{value:gross,color:[197,213,202] as Color,offset:-barWidth*.58},{value:net,color:COLOR.green,offset:barWidth*.58}];
  series.forEach(entry=>{const barHeight=entry.value/maximum*chartHeight;fill(doc,entry.color);doc.roundedRect(center+entry.offset-barWidth/2,base-barHeight,barWidth,barHeight,.65,.65,'F');});
  receivedPoints.push({x:center,y:base-received/maximum*chartHeight});
  doc.setFontSize(5.1);textColor(doc,COLOR.muted);doc.text(`${monthLabel(item.month).slice(0,3)}/${item.month.slice(2,4)}`,center,base+4,{align:'center'});
  if(item.billingPending){textColor(doc,COLOR.amber);doc.setFont('helvetica','bold');doc.text('*',center,chartY+2,{align:'center'});doc.setFont('helvetica','normal');}
 });
 stroke(doc,COLOR.blue);doc.setLineWidth(.75);for(let index=1;index<receivedPoints.length;index++)doc.line(receivedPoints[index-1].x,receivedPoints[index-1].y,receivedPoints[index].x,receivedPoints[index].y);
 fill(doc,COLOR.blue);receivedPoints.forEach(point=>doc.circle(point.x,point.y,.75,'F'));doc.setLineWidth(.2);
}

function drawTrendPanel(doc:JsPdf,rows:ExecutiveSummaryMonth[],x:number,y:number,width:number,height:number,title='Faturamento e entradas'){
 card(doc,x,y,width,height,3);
 doc.setFont('helvetica','bold');doc.setFontSize(5.5);textColor(doc,COLOR.green);doc.text('EVOLUÇÃO MÊS A MÊS',x+7,y+7);
 doc.setFontSize(11);textColor(doc,COLOR.ink);doc.text(title,x+7,y+13);
 const legendX=x+width-64,legendY=y+8;
 const legends=[['Bruto',[197,213,202] as Color],['Líquido',COLOR.green],['Entradas',COLOR.blue]] as const;
 doc.setFont('helvetica','normal');doc.setFontSize(5.5);legends.forEach(([label,color],index)=>{fill(doc,color);doc.circle(legendX+index*21,legendY,.9,'F');textColor(doc,COLOR.muted);doc.text(label,legendX+2+index*21,legendY+1.2);});
 if(rows.length)drawTrendChart(doc,rows,x,y,width,height);
 else{doc.setFontSize(8);textColor(doc,COLOR.muted);doc.text('A evolução começa com a primeira movimentação.',x+width/2,y+height/2,{align:'center'});}
}

function drawComposition(doc:JsPdf,data:ExecutiveSummaryData,x:number,y:number,width:number,height:number){
 card(doc,x,y,width,height,3);
 doc.setFont('helvetica','bold');doc.setFontSize(5.5);textColor(doc,COLOR.green);doc.text('COMPOSIÇÃO FINANCEIRA',x+7,y+7);
 doc.setFontSize(11);textColor(doc,COLOR.ink);doc.text('Do bruto ao líquido',x+7,y+13);
 const cx=x+width/2,cy=y+33,radius=12,total=numeric(data.totals.netAmount)+numeric(data.totals.discountAmount);
 drawArc(doc,cx,cy,radius,-90,270,COLOR.grid,5);
 if(!data.totals.billingPending&&total>0){
  const split=-90+360*numeric(data.totals.netAmount)/total;
  drawArc(doc,cx,cy,radius,-88,split-2,COLOR.green,5);drawArc(doc,cx,cy,radius,split+2,268,COLOR.amber,5);
 }
 doc.setFont('helvetica','normal');doc.setFontSize(5.5);textColor(doc,COLOR.muted);doc.text('Faturamento bruto',cx,cy-1,{align:'center'});
 doc.setFont('helvetica','bold');doc.setFontSize(7.5);textColor(doc,COLOR.ink);doc.text(safe(doc,moneyLabel(data.totals.grossAmount),27),cx,cy+3,{align:'center'});
 const legendY=y+height-13,items=[['Líquido',moneyLabel(data.totals.netAmount),COLOR.green],['Descontos',moneyLabel(data.totals.discountAmount),COLOR.amber]] as const;
 items.forEach(([label,value,color],index)=>{const itemY=legendY+index*7;fill(doc,color);doc.circle(x+8,itemY-.5,1.2,'F');doc.setFont('helvetica','normal');doc.setFontSize(6);textColor(doc,COLOR.muted);doc.text(label,x+11,itemY+1);doc.setFont('helvetica','bold');textColor(doc,COLOR.ink);doc.text(safe(doc,value,width-36),x+width-7,itemY+1,{align:'right'});});
}

export async function createSummaryPdf(snapshot:ExecutiveSummarySnapshot,brand:ReportPdfBrand){
 const {jsPDF}=await import('@/shared/reporting/jsPdfRuntime');
 const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
 const {data}=snapshot,margin=REPORT_MARGIN_MM,pageWidth=doc.internal.pageSize.getWidth(),pageHeight=doc.internal.pageSize.getHeight();
 const contentWidth=pageWidth-margin*2,bottom=pageHeight-margin-9;
 const operationalTotals=data.operationalTotals??{loadCount:data.totals.loadCount,loadedVolume:data.totals.loadedVolume,averageAtr:'',averageLoadVolume:data.totals.loadCount?String(numeric(data.totals.loadedVolume)/data.totals.loadCount):'0',contractCount:data.totals.contractCount,farmCount:data.totals.farmCount,plotCount:data.totals.plotCount};
 const monthlyOperations=data.monthlyOperations??data.months.map(item=>({month:item.month,loadCount:item.loadCount,loadedVolume:item.loadedVolume,averageAtr:'',averageLoadVolume:item.loadCount?String(numeric(item.loadedVolume)/item.loadCount):'0',contractCount:0,farmCount:0,plotCount:0}));
 const farmPerformance=data.farmPerformance??[];
 const plotPerformance=data.plotPerformance??[];
 const contractPerformanceRows=data.contractPerformance??[];
 const planningPerformance=data.planningPerformance??{periodName:data.planning.periodName,farms:[],plots:[]};
 const [logo,watermark]=await Promise.all([loadReportImage(brand.company?.logoUrl??null),loadReportImage(brand.watermark.imageUrl)]);
 let y=0,currentSection='Painel executivo';

 const pageHeader=(section:string)=>{
  fill(doc,COLOR.page);doc.rect(0,0,pageWidth,pageHeight,'F');
  drawReportPdfWatermark(doc,pageWidth,pageHeight,brand.watermark,watermark);
  const line=drawReportPdfHeader({doc,pageWidth,margin,orientation:'landscape',settings:brand.header,company:brand.company,logo,title:'Resumo gerencial'});
  doc.setFont('helvetica','normal');doc.setFontSize(7);textColor(doc,COLOR.muted);doc.text(`${dateLabel(data.range.from)} a ${dateLabel(data.range.to)} · ${data.range.dayCount} dias`,margin,line+6);
  fill(doc,COLOR.greenSoft);doc.roundedRect(pageWidth-margin-39,line+1,39,8,4,4,'F');doc.setFont('helvetica','bold');doc.setFontSize(6);textColor(doc,COLOR.green);doc.text(safe(doc,section.toLocaleUpperCase('pt-BR'),33),pageWidth-margin-19.5,line+6.1,{align:'center'});
  return line+13;
 };
 const newPage=(section:string)=>{doc.addPage();currentSection=section;y=pageHeader(section);};
 const ensure=(space:number,section=currentSection)=>{if(y+space>bottom)newPage(section);};
 const sectionTitle=(kicker:string,title:string,subtitle='')=>{
  ensure(subtitle?17:13,title);currentSection=title;
  doc.setFont('helvetica','bold');doc.setFontSize(5.5);textColor(doc,COLOR.green);doc.text(kicker.toLocaleUpperCase('pt-BR'),margin,y+4);
  doc.setFontSize(11);textColor(doc,COLOR.ink);doc.text(title,margin,y+10);
  if(subtitle){doc.setFont('helvetica','normal');doc.setFontSize(6.2);textColor(doc,COLOR.muted);doc.text(safe(doc,subtitle,contentWidth),margin,y+14);y+=19;}else y+=14;
 };
 const table=(kicker:string,title:string,columns:Column[],rows:string[][],rowHeight=9)=>{
  sectionTitle(kicker,title);const head=8;
  const drawHead=()=>{fill(doc,COLOR.greenSoft);doc.roundedRect(margin,y,contentWidth,head,1.4,1.4,'F');doc.setFont('helvetica','bold');doc.setFontSize(6.3);textColor(doc,COLOR.deepLight);let x=margin;columns.forEach(column=>{doc.text(column.label,column.align==='right'?x+column.width-2:x+2,y+5.2,{align:column.align??'left'});x+=column.width;});y+=head;};
  if(!rows.length){card(doc,margin,y,contentWidth,13,2);doc.setFont('helvetica','normal');doc.setFontSize(7);textColor(doc,COLOR.muted);doc.text('Nenhum registro no período.',margin+4,y+8);y+=17;return;}
  ensure(head+rowHeight,title);drawHead();
  rows.forEach((row,index)=>{
   if(y+rowHeight>bottom){newPage(title);drawHead();}
   fill(doc,index%2?COLOR.greenPale:COLOR.white);doc.rect(margin,y,contentWidth,rowHeight,'F');
   let x=margin;doc.setFont('helvetica','normal');doc.setFontSize(6.4);textColor(doc,COLOR.ink);
   row.forEach((value,columnIndex)=>{const column=columns[columnIndex];doc.text(safe(doc,value,column.width-4),column.align==='right'?x+column.width-2:x+2,y+5.7,{align:column.align??'left'});x+=column.width;});
   stroke(doc,COLOR.line);doc.line(margin,y+rowHeight,pageWidth-margin,y+rowHeight);y+=rowHeight;
  });
  y+=4;
 };

 // Page 1 — mirrors the visual hierarchy of the on-screen executive dashboard.
 y=pageHeader('Painel executivo');
 const heroY=y,heroHeight=43;fill(doc,COLOR.deep);doc.roundedRect(margin,heroY,contentWidth,heroHeight,5,5,'F');
 stroke(doc,[58,105,76]);doc.setLineWidth(.3);doc.circle(pageWidth-margin+2,heroY+42,29,'S');doc.circle(pageWidth-margin+2,heroY+42,20,'S');doc.setLineWidth(.2);
 const heroMainWidth=139,heroVolumeX=margin+151,heroMovementX=margin+211;
 doc.setFont('helvetica','bold');doc.setFontSize(5.6);textColor(doc,[188,218,199]);doc.text(`FATURAMENTO LÍQUIDO · ${dateLabel(data.range.from)} A ${dateLabel(data.range.to)}`,margin+8,heroY+9);
 doc.setFontSize(22);textColor(doc,COLOR.white);doc.text(safe(doc,moneyLabel(data.totals.netAmount),heroMainWidth-16),margin+8,heroY+21);
 fill(doc,[55,94,70]);doc.roundedRect(margin+8,heroY+26,62,8,4,4,'F');doc.setFont('helvetica','normal');doc.setFontSize(5.8);textColor(doc,[218,238,225]);doc.text(safe(doc,comparison(data.comparison.netChangePercent),56),margin+12,heroY+31.2);
 doc.setFontSize(5.7);textColor(doc,[190,210,197]);doc.text('Valor das cargas após descontos. Pendências permanecem “A apurar”.',margin+8,heroY+39);
 stroke(doc,[67,108,81]);doc.line(margin+143,heroY+9,margin+143,heroY+35);doc.line(margin+204,heroY+9,margin+204,heroY+35);
 doc.setFont('helvetica','bold');doc.setFontSize(5.4);textColor(doc,[177,209,188]);doc.text('VOLUME CARREGADO',heroVolumeX,heroY+11);doc.setFontSize(14);textColor(doc,COLOR.white);doc.text(`${decimalLabel(data.totals.loadedVolume)} t`,heroVolumeX,heroY+22);doc.setFont('helvetica','normal');doc.setFontSize(5.7);textColor(doc,[190,210,197]);doc.text(safe(doc,comparison(data.comparison.volumeChangePercent),50),heroVolumeX,heroY+30);
 doc.setFont('helvetica','bold');doc.setFontSize(5.4);textColor(doc,[177,209,188]);doc.text('MOVIMENTAÇÃO',heroMovementX,heroY+11);doc.setFontSize(14);textColor(doc,COLOR.white);doc.text(`${data.totals.loadCount} cargas`,heroMovementX,heroY+22);doc.setFont('helvetica','normal');doc.setFontSize(5.7);textColor(doc,[190,210,197]);doc.text(`${data.totals.activeContractCount} contratos ativos`,heroMovementX,heroY+30);
 y=heroY+heroHeight+5;

 const metrics=[
  {label:'Faturamento bruto',value:moneyLabel(data.totals.grossAmount),detail:data.totals.billingPending?`${data.totals.pendingLoadCount} carga(s) a apurar`:'Valor das entregas',color:COLOR.green},
  {label:'Descontos',value:moneyLabel(data.totals.discountAmount),detail:'Acordos aplicados às cargas',color:COLOR.amber},
  {label:'Entradas em caixa',value:moneyLabel(data.totals.receivedAmount),detail:`${moneyLabel(data.totals.advanceAmount)} adiantado`,color:COLOR.blue},
  {label:'Diferença do recorte',value:moneyLabel(data.totals.pendingAmount),detail:'Líquido menos entradas nas datas',color:COLOR.green},
 ];
 const metricGap=4,metricWidth=(contentWidth-metricGap*3)/4,metricHeight=24;
 metrics.forEach((item,index)=>{const x=margin+index*(metricWidth+metricGap);card(doc,x,y,metricWidth,metricHeight,2.5);fill(doc,item.color);doc.roundedRect(x,y,2.2,metricHeight,1.1,1.1,'F');doc.setFont('helvetica','normal');doc.setFontSize(6);textColor(doc,COLOR.muted);doc.text(item.label,x+6,y+6);doc.setFont('helvetica','bold');doc.setFontSize(10.5);textColor(doc,COLOR.deep);doc.text(safe(doc,item.value,metricWidth-12),x+6,y+14);doc.setFont('helvetica','normal');doc.setFontSize(5.3);textColor(doc,COLOR.muted);doc.text(safe(doc,item.detail,metricWidth-12),x+6,y+20);});
 y+=metricHeight+6;
 const analyticsHeight=bottom-y,compositionWidth=78,analyticsGap=5;
 drawTrendPanel(doc,data.months.slice(0,12),margin,y,contentWidth-compositionWidth-analyticsGap,analyticsHeight);
 drawComposition(doc,data,pageWidth-margin-compositionWidth,y,compositionWidth,analyticsHeight);

 // Long periods keep the same chart language and receive one readable page per 12 months.
 const laterMonths=Array.from({length:Math.ceil(Math.max(0,data.months.length-12)/12)},(_,index)=>data.months.slice(12+index*12,24+index*12));
 laterMonths.forEach(chunk=>{
  newPage('Evolução financeira');
  sectionTitle('HISTÓRICO FINANCEIRO',`Evolução · ${monthLabel(chunk[0].month)} a ${monthLabel(chunk.at(-1)!.month)}`,'Bruto, líquido e entradas em caixa, preservando meses com valores ainda a apurar.');
  drawTrendPanel(doc,chunk,margin,y,contentWidth,72);y+=78;
  table('DETALHAMENTO MENSAL','Valores do período',[{label:'Mês',width:49},{label:'Bruto',width:48,align:'right'},{label:'Líquido',width:48,align:'right'},{label:'Entradas',width:48,align:'right'},{label:'Volume',width:43,align:'right'},{label:'Cargas',width:33,align:'right'}],chunk.map(item=>[monthLabel(item.month),moneyLabel(item.grossAmount),moneyLabel(item.netAmount),moneyLabel(item.receivedAmount),`${decimalLabel(item.loadedVolume)} t`,String(item.loadCount)]));
 });

 // Operation and planning page.
 newPage('Operação agrícola');
 fill(doc,COLOR.deep);doc.roundedRect(margin,y,contentWidth,24,4,4,'F');
 doc.setFont('helvetica','bold');doc.setFontSize(5.5);textColor(doc,[181,212,191]);doc.text('OPERAÇÃO DA EMPRESA',margin+8,y+7);
 doc.setFontSize(13);textColor(doc,COLOR.white);doc.text('De onde veio a produção',margin+8,y+15);
 doc.setFont('helvetica','normal');doc.setFontSize(6);textColor(doc,[194,214,201]);doc.text('Fazendas e talhões com carregamentos no período selecionado.',margin+8,y+21);
 const operationStats=[['FAZENDAS',String(operationalTotals.farmCount)],['TALHÕES',String(operationalTotals.plotCount)],['ATR MÉDIO',`${decimalLabel(operationalTotals.averageAtr)}`],['T/CARGA',decimalLabel(operationalTotals.averageLoadVolume)]];
 operationStats.forEach(([label,value],index)=>{const x=pageWidth-margin-124+index*31;doc.setFont('helvetica','bold');doc.setFontSize(4.7);textColor(doc,[174,204,185]);doc.text(label,x,y+8);doc.setFontSize(9);textColor(doc,COLOR.white);doc.text(safe(doc,value,27),x,y+17);});
 y+=29;
 const farmPanelWidth=176,operationGap=5,registryWidth=contentWidth-farmPanelWidth-operationGap,panelHeight=48;
 card(doc,margin,y,farmPanelWidth,panelHeight,3);doc.setFont('helvetica','bold');doc.setFontSize(5.5);textColor(doc,COLOR.green);doc.text('VOLUME POR FAZENDA',margin+7,y+7);doc.setFontSize(10);textColor(doc,COLOR.ink);doc.text('Participação na produção',margin+7,y+13);
 const farms=[...data.farms].sort((a,b)=>numeric(b.loadedVolume)-numeric(a.loadedVolume)),visibleFarms=farms.slice(0,4),farmMax=Math.max(...visibleFarms.map(item=>numeric(item.loadedVolume)),1);
 if(visibleFarms.length)visibleFarms.forEach((farm,index)=>{const rowY=y+20+index*6.4,labelWidth=47,barX=margin+7+labelWidth,barWidth=farmPanelWidth-labelWidth-37,value=numeric(farm.loadedVolume);doc.setFont('helvetica','normal');doc.setFontSize(5.6);textColor(doc,COLOR.muted);doc.text(safe(doc,farm.name,labelWidth-3),margin+7,rowY+1.5);fill(doc,COLOR.greenSoft);doc.roundedRect(barX,rowY-1.7,barWidth,3.4,1.7,1.7,'F');fill(doc,COLOR.green);doc.roundedRect(barX,rowY-1.7,Math.max(value/farmMax*barWidth,.8),3.4,1.7,1.7,'F');doc.setFont('helvetica','bold');textColor(doc,COLOR.deep);doc.text(`${decimalLabel(farm.loadedVolume)} t`,margin+farmPanelWidth-6,rowY+1.3,{align:'right'});});
 else{doc.setFont('helvetica','normal');doc.setFontSize(7);textColor(doc,COLOR.muted);doc.text('Nenhuma fazenda movimentada no período.',margin+farmPanelWidth/2,y+34,{align:'center'});}
 const registryX=margin+farmPanelWidth+operationGap;card(doc,registryX,y,registryWidth,panelHeight,3);doc.setFont('helvetica','bold');doc.setFontSize(5.5);textColor(doc,COLOR.green);doc.text('CADASTRO AGRÍCOLA ATUAL',registryX+7,y+7);doc.setFontSize(10);textColor(doc,COLOR.ink);doc.text('Estrutura do workspace',registryX+7,y+13);
 const registry=[['Fazendas',String(data.agriculture.registeredFarmCount)],['Talhões',String(data.agriculture.registeredPlotCount)],['Área total',`${decimalLabel(data.agriculture.farmAreaHa)} ha`],['Área mapeada',`${decimalLabel(data.agriculture.plotAreaHa)} ha`]];
 registry.forEach(([label,value],index)=>{const col=index%2,row=Math.floor(index/2),boxWidth=(registryWidth-17)/2,boxX=registryX+6+col*(boxWidth+5),boxY=y+17+row*14;fill(doc,COLOR.greenPale);doc.roundedRect(boxX,boxY,boxWidth,11,2,2,'F');doc.setFont('helvetica','normal');doc.setFontSize(4.8);textColor(doc,COLOR.muted);doc.text(label,boxX+3,boxY+4);doc.setFont('helvetica','bold');doc.setFontSize(7);textColor(doc,COLOR.deep);doc.text(safe(doc,value,boxWidth-6),boxX+3,boxY+8.6);});
 y+=panelHeight+6;
 sectionTitle('PLANEJAMENTO DO WORKSPACE',data.planning.periodName||'Metas e execução agrícola',data.planning.periodName?`Safra em foco · acumulado até ${dateLabel(data.planning.progressAsOf)}`:'Nenhuma safra cruza o período selecionado.');
 const planningCards=[
  {label:'PLANTIO',percent:data.planning.plantingPercent,value:`${decimalLabel(data.planning.plantedAreaHa)} ha`,target:`Meta ${decimalLabel(data.planning.targetAreaHa)} ha`},
  {label:'COLHEITA',percent:data.planning.harvestPercent,value:`${decimalLabel(data.planning.harvestedTons)} t`,target:`Meta ${decimalLabel(data.planning.harvestTargetTons)} t`},
  {label:'MANEJO',percent:'',value:`${decimalLabel(data.planning.managedAreaHa)} ha`,target:`${data.planning.managementEventCount} ocorrências`},
 ];
 const planningGap=5,planningWidth=(contentWidth-planningGap*2)/3,planningHeight=31;
 planningCards.forEach((item,index)=>{const x=margin+index*(planningWidth+planningGap);card(doc,x,y,planningWidth,planningHeight,3);doc.setFont('helvetica','bold');doc.setFontSize(5.3);textColor(doc,COLOR.green);doc.text(item.label,x+6,y+6);doc.setFontSize(11);textColor(doc,COLOR.deep);doc.text(item.value,x+6,y+14);doc.setFont('helvetica','normal');doc.setFontSize(5.5);textColor(doc,COLOR.muted);doc.text(item.target,x+6,y+20);if(item.percent!==''){fill(doc,COLOR.greenSoft);doc.roundedRect(x+6,y+24,planningWidth-12,3.5,1.75,1.75,'F');fill(doc,COLOR.green);doc.roundedRect(x+6,y+24,Math.max((planningWidth-12)*clampPercent(item.percent)/100,.8),3.5,1.75,1.75,'F');doc.setFont('helvetica','bold');doc.setFontSize(5.7);textColor(doc,COLOR.deep);doc.text(`${decimalLabel(item.percent)}%`,x+planningWidth-7,y+21,{align:'right'});}});

 // Complete agricultural detail, without truncating the executive data.
 newPage('Detalhamento agrícola');
 const operationRows=monthlyOperations.filter(item=>item.loadCount>0||numeric(item.loadedVolume)>0).map(item=>[monthLabel(item.month),String(item.loadCount),`${decimalLabel(item.loadedVolume)} t`,`${decimalLabel(item.averageAtr)} kg/t`,`${decimalLabel(item.averageLoadVolume)} t`,String(item.contractCount),String(item.farmCount),String(item.plotCount)]);
 if(operationRows.length){operationRows.push(['GERAL',String(operationalTotals.loadCount),`${decimalLabel(operationalTotals.loadedVolume)} t`,`${decimalLabel(operationalTotals.averageAtr)} kg/t`,`${decimalLabel(operationalTotals.averageLoadVolume)} t`,String(operationalTotals.contractCount),String(operationalTotals.farmCount),String(operationalTotals.plotCount)]);table('MOVIMENTAÇÃO MENSAL','Meses com carregamentos',[{label:'Mês',width:52},{label:'Cargas',width:24,align:'right'},{label:'Volume',width:42,align:'right'},{label:'ATR médio',width:37,align:'right'},{label:'Média/carga',width:39,align:'right'},{label:'Contratos',width:25,align:'right'},{label:'Fazendas',width:25,align:'right'},{label:'Talhões',width:25,align:'right'}],operationRows,8);}
 table('DESEMPENHO DAS ORIGENS','Fazendas movimentadas',[{label:'Fazenda',width:68},{label:'Talhões',width:22,align:'right'},{label:'Cargas',width:22,align:'right'},{label:'Volume',width:38,align:'right'},{label:'ATR médio',width:32,align:'right'},{label:'Média/carga',width:34,align:'right'},{label:'t/ha',width:31,align:'right'},{label:'Contratos',width:22,align:'right'}],farmPerformance.map(item=>[item.name,String(item.plotCount),String(item.loadCount),`${decimalLabel(item.loadedVolume)} t`,decimalLabel(item.averageAtr),`${decimalLabel(item.averageLoadVolume)} t`,decimalLabel(item.tonsPerHa),String(item.contractCount)]));
 table('DESEMPENHO DAS ORIGENS','Talhões movimentados',[{label:'Fazenda / talhão',width:80},{label:'Área',width:30,align:'right'},{label:'Cargas',width:22,align:'right'},{label:'Volume',width:38,align:'right'},{label:'ATR médio',width:32,align:'right'},{label:'Média/carga',width:34,align:'right'},{label:'t/ha',width:33,align:'right'}],plotPerformance.map(item=>[`${item.farmName} · ${item.name}`,`${decimalLabel(item.areaHa)} ha`,String(item.loadCount),`${decimalLabel(item.loadedVolume)} t`,decimalLabel(item.averageAtr),`${decimalLabel(item.averageLoadVolume)} t`,decimalLabel(item.tonsPerHa)]));
 table('MANEJO REALIZADO','Práticas na safra em foco',[{label:'Prática',width:160},{label:'Ocorrências',width:45,align:'right'},{label:'Área manejada',width:64,align:'right'}],data.management.map(item=>[item.name,String(item.eventCount),`${decimalLabel(item.areaHa)} ha`]));
 table('METAS DA SAFRA','Progresso por fazenda',[{label:'Fazenda',width:80},{label:'Plantio',width:40,align:'right'},{label:'%',width:25,align:'right'},{label:'Colheita',width:40,align:'right'},{label:'%',width:25,align:'right'},{label:'Restante',width:37,align:'right'},{label:'Cargas',width:22,align:'right'}],planningPerformance.farms.map(item=>[item.name,`${decimalLabel(item.plantedAreaHa)} / ${decimalLabel(item.targetAreaHa)} ha`,`${decimalLabel(item.plantingPercent)}%`,`${decimalLabel(item.harvestedTons)} / ${decimalLabel(item.targetTons)} t`,`${decimalLabel(item.harvestPercent)}%`,`${decimalLabel(item.remainingTons)} t`,String(item.loadCount)]));
 table('METAS DA SAFRA','Progresso por talhão',[{label:'Fazenda / talhão',width:80},{label:'Plantio',width:40,align:'right'},{label:'%',width:25,align:'right'},{label:'Colheita',width:40,align:'right'},{label:'%',width:25,align:'right'},{label:'Restante',width:37,align:'right'},{label:'Cargas',width:22,align:'right'}],planningPerformance.plots.map(item=>[`${item.farmName} · ${item.name}`,`${decimalLabel(item.plantedAreaHa)} / ${decimalLabel(item.targetAreaHa)} ha`,`${decimalLabel(item.plantingPercent)}%`,`${decimalLabel(item.harvestedTons)} / ${decimalLabel(item.targetTons)} t`,`${decimalLabel(item.harvestPercent)}%`,`${decimalLabel(item.remainingTons)} t`,String(item.loadCount)]));

 // Contracts page(s), with all records and status context.
 newPage('Contratos e resultados');
 sectionTitle('CONTRATOS DA EMPRESA ATIVA','Contratos e resultados','Ordenados pelo volume movimentado no período selecionado.');
 if(data.contractStatus.length){let statusX=margin;data.contractStatus.forEach(item=>{const label=`${item.status}  ${item.count}`,pillWidth=Math.min(47,doc.getTextWidth(label)+12);fill(doc,COLOR.greenSoft);doc.roundedRect(statusX,y,pillWidth,8,4,4,'F');doc.setFont('helvetica','bold');doc.setFontSize(6);textColor(doc,COLOR.deepLight);doc.text(label,statusX+pillWidth/2,y+5.2,{align:'center'});statusX+=pillWidth+3;});y+=12;}
 const contractPerformance=new Map(contractPerformanceRows.map(item=>[item.id,item]));
 table('VISÃO CONTRATUAL','Movimentação por contrato',[{label:'Cliente / contrato',width:57},{label:'Status',width:20},{label:'Cargas',width:16,align:'right'},{label:'Volume',width:28,align:'right'},{label:'ATR',width:25,align:'right'},{label:'Entrega',width:33,align:'right'},{label:'Líquido',width:45,align:'right'},{label:'Entradas',width:45,align:'right'}],data.contracts.map(item=>{const performance=contractPerformance.get(item.id);return [`${item.clientName} · ${item.contractNumber||item.title}`,item.status,String(item.loadCount),`${decimalLabel(item.loadedVolume)} t`,decimalLabel(performance?.averageAtr),performance?`${decimalLabel(performance.deliveryPercent)}% · ${decimalLabel(performance.totalLoadedVolume)}/${decimalLabel(performance.contractedVolume)} t`:'—',moneyLabel(item.netAmount),moneyLabel(item.receivedAmount)];}));
 sectionTitle('NOTAS DE LEITURA','Como interpretar este resumo');doc.setFont('helvetica','normal');doc.setFontSize(6.5);textColor(doc,COLOR.muted);
 const notes=[
  'Financeiro, contratos, carregamentos e fazendas movimentadas pertencem à empresa ativa. Planejamento, cadastro agrícola e manejo pertencem ao workspace.',
  'Entradas usam a data efetiva do caixa. A diferença do recorte compara líquido das cargas e entradas ocorridas nas datas selecionadas; não substitui o saldo contratual por competência.',
  'Área cadastrada é o retrato atual. O progresso agrícola usa uma única safra em foco para não somar metas de safras sobrepostas.',
  'O indicador t/ha divide o volume carregado no filtro pela área atualmente cadastrada; ele mede intensidade do período e não substitui uma estimativa agronômica de produtividade.',
 ];
 notes.forEach((note,index)=>{const lines=doc.splitTextToSize(note,contentWidth-12) as string[];ensure(lines.length*3.4+4,'Notas de leitura');fill(doc,index===1?COLOR.amberSoft:COLOR.greenPale);doc.roundedRect(margin,y,contentWidth,lines.length*3.4+4,2,2,'F');fill(doc,index===1?COLOR.amber:COLOR.green);doc.circle(margin+4,y+4,1,'F');doc.setFont('helvetica','normal');doc.setFontSize(6.5);textColor(doc,COLOR.muted);doc.text(lines,margin+8,y+4.8);y+=lines.length*3.4+7;});

 const pages=doc.getNumberOfPages(),emitted=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(brand.issuedAt);
 for(let page=1;page<=pages;page++){
  doc.setPage(page);stroke(doc,COLOR.line);doc.line(margin,pageHeight-margin-4,pageWidth-margin,pageHeight-margin-4);
  doc.setFont('helvetica','normal');doc.setFontSize(6);textColor(doc,COLOR.muted);doc.text(safe(doc,`Emitido por ${brand.issuer.name||brand.issuer.email} · ${emitted}`,contentWidth-35),margin,pageHeight-margin);
  doc.setFont('helvetica','bold');textColor(doc,COLOR.deepLight);doc.text(`${page} / ${pages}`,pageWidth-margin,pageHeight-margin,{align:'right'});
 }
 return {doc,fileName:`resumo-gerencial-${data.range.from}-a-${data.range.to}.pdf`};
}
