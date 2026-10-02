import {drawReportPdfHeader,drawReportPdfWatermark,REPORT_MARGIN_MM,type ReportPdfImage} from '@/shared/reporting';
import {formatCnpj} from '@/shared/utils/cnpj';
import type {BillingContract,ContractLoadsData} from '../types';
import {contractSummaryDetails,summaryReceivedNote,type SummaryTable} from '../utils/contractSummaryDetails';
import {contractDailyLoadGranularityCopy,contractDailyLoadsChartRows,contractLoadFinancialChartRows,type ContractDailyLoadPeriod,type ContractLoadFinancialChartRow} from '../utils/contractDailyLoadsPresentation';
import {formatAtr,formatAtrCriterion,formatContractDate,formatContractMonth,formatContractVolume} from '../utils/contractFormat';
import {filterContractMonths,monthIsInContractPeriod,type ContractMonthlyPeriod} from '../utils/contractMonthlyPeriod';
import type {ContractMonthlyReportBrand} from './contractMonthlySummaryPdf';

type Color=[number,number,number];
type SummaryCard={label:string;value:string;hint:string;key?:string};
type SummaryIcon='gauge'|'scale'|'package'|'truck'|'money'|'calendar';
const palette={ink:[23,37,29],muted:[74,91,80],border:[204,219,209],surface:[249,252,250],green:[53,165,109],dark:[30,79,54],blue:[76,129,165],amber:[209,138,53]} satisfies Record<string,Color>;

async function loadImage(url:string|null):Promise<ReportPdfImage|null>{
 if(!url)return null;
 const response=await fetch(url);
 if(!response.ok)throw new Error('Não foi possível carregar a identidade visual do relatório. Tente novamente.');
 const blob=await response.blob();let ratio:number;
 if(typeof createImageBitmap==='function'){const image=await createImageBitmap(blob);ratio=image.width/image.height;image.close();}
 else{const objectUrl=URL.createObjectURL(blob);try{ratio=await new Promise<number>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth/image.naturalHeight);image.onerror=reject;image.src=objectUrl;});}finally{URL.revokeObjectURL(objectUrl);}}
 return {bytes:new Uint8Array(await blob.arrayBuffer()),format:blob.type.includes('png')?'PNG':blob.type.includes('webp')?'WEBP':'JPEG',ratio};
}

// Arithmetic measures page and chart geometry. Financial results come from the RPC.
export async function createContractSummaryDocument(contract:BillingContract,brand:ContractMonthlyReportBrand,monthlyPeriod?:ContractMonthlyPeriod,dailyLoads?:ContractLoadsData,dailyPeriod?:ContractDailyLoadPeriod){
 const {jsPDF}=await import('@/shared/reporting/jsPdfRuntime');
 const doc=new jsPDF({orientation:brand.orientation,unit:'mm',format:'a4',compress:true});
 const summary=contractSummaryDetails(contract);
 const effectiveMonthlyPeriod=dailyPeriod?.from&&dailyPeriod?.to?{from:dailyPeriod.from.slice(0,7),to:dailyPeriod.to.slice(0,7)}:monthlyPeriod;
 const filteredMonths=filterContractMonths(summary.months,effectiveMonthlyPeriod),margin=REPORT_MARGIN_MM;
 const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight(),content=width-margin*2,bottom=height-margin-10;
 const [logo,watermark]=await Promise.all([loadImage(brand.company?.logoUrl??null),loadImage(brand.watermark.imageUrl)]);
 let y=0;
 const font=(size:number,bold=false,color:Color=palette.ink)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);};
 const lines=(value:string,size:number,maxWidth:number,bold=false)=>{font(size,bold);return doc.splitTextToSize(value,maxWidth) as string[];};
 const panel=(x:number,top:number,panelWidth:number,panelHeight:number,fill:Color=[255,255,255],border:Color=palette.border)=>{
  doc.setLineWidth(.2);doc.setFillColor(...fill);doc.setDrawColor(...border);doc.roundedRect(x,top,panelWidth,panelHeight,2.2,2.2,'FD');
 };
 const icon=(kind:SummaryIcon,x:number,top:number)=>{
  doc.setFillColor(230,244,234);doc.roundedRect(x,top,7.5,7.5,1.8,1.8,'F');
  doc.setDrawColor(47,133,84);doc.setLineWidth(.38);const cx=x+3.75,cy=top+3.75;
  if(kind==='money'){doc.circle(cx,cy,2.1,'S');font(8,true,[47,133,84]);doc.text('$',cx,cy+1,{align:'center'});}
  else if(kind==='calendar'){doc.roundedRect(x+1.6,top+1.9,4.3,4.1,.5,.5,'S');doc.line(x+1.6,top+3,x+5.9,top+3);doc.line(x+2.7,top+1.3,x+2.7,top+2.5);doc.line(x+4.8,top+1.3,x+4.8,top+2.5);doc.rect(x+2.5,top+3.8,.5,.5,'F');doc.rect(x+4.3,top+3.8,.5,.5,'F');doc.rect(x+2.5,top+5,.5,.5,'F');}
  else if(kind==='gauge'){doc.circle(cx,cy,2.1,'S');doc.setFillColor(230,244,234);doc.rect(x+1.3,cy+1.1,5,1.4,'F');doc.line(cx,cy,cx+1.3,cy-1.1);}
  else if(kind==='scale'){doc.line(cx,top+1.3,cx,top+6);doc.line(x+2.2,top+6,x+5.3,top+6);doc.line(x+1.4,top+2.3,x+6.1,top+2.3);for(const offset of [1.9,5.6]){doc.line(x+offset,top+2.3,x+offset-.8,top+4.5);doc.line(x+offset,top+2.3,x+offset+.8,top+4.5);doc.line(x+offset-.8,top+4.5,x+offset+.8,top+4.5);}}
  else if(kind==='package'){doc.lines([[2.1,-1.2],[2.1,1.2],[0,2.5],[-2.1,1.2],[-2.1,-1.2],[0,-2.5]],x+1.65,top+2.5,[1,1],'S',true);doc.line(x+1.65,top+2.5,cx,top+3.7);doc.line(cx,top+3.7,x+5.85,top+2.5);doc.line(cx,top+3.7,cx,top+6.2);}
  else{doc.rect(x+1.2,top+2,3.1,3.4,'S');doc.lines([[1.3,0],[1,1.2],[0,2.2],[-2.3,0]],x+4.3,top+2,[1,1],'S');doc.setFillColor(230,244,234);doc.circle(x+2.3,top+5.5,.7,'FD');doc.circle(x+5.2,top+5.5,.7,'FD');}
 };
 const heading=(x:number,top:number,kicker:string,title:string,kind:SummaryIcon)=>{
  icon(kind,x,top);font(6,true,palette.muted);doc.text(kicker,x+10.5,top+2.5);font(9.5,true);doc.text(title,x+10.5,top+7);
 };
 const startPage=()=>{
  drawReportPdfWatermark(doc,width,height,brand.watermark,watermark);
 y=drawReportPdfHeader({doc,pageWidth:width,margin,orientation:brand.orientation,settings:brand.header,company:brand.company,logo,title:'Resumo do contrato'})+6;
  const first=doc.getNumberOfPages()===1;
  const identity=lines(contract.clientName,first?13:8,content,true);
  font(first?13:8,true);doc.text(identity,margin,y,{lineHeightFactor:1.25});y+=identity.length*(first?5.7:3.7)+1;
  if(contract.clientCnpj){font(first?7:6.5,false,palette.muted);doc.text('CNPJ: '+formatCnpj(contract.clientCnpj),margin,y);y+=first?4:3.5;}
  if(first){
   const details=lines(`${contract.typeName} · ${contract.companyName} · Nº ${contract.contractNumber||'Não informado'}`,7,content);
   font(7,false,palette.muted);doc.text(details,margin,y,{lineHeightFactor:1.3});y+=details.length*3.3;
   doc.setDrawColor(...palette.border);doc.line(margin,y+1,width-margin,y+1);y+=5;
  }else{
   font(6.5,false,palette.muted);doc.text('Nº do contrato: '+(contract.contractNumber||'Não informado'),margin,y);y+=6;
  }
 };
 const newPage=()=>{doc.addPage();startPage();};
 const ensure=(space:number)=>{if(y+space>bottom)newPage();};
 const paragraph=(value:string,size=8,bold=false)=>{
  const text=lines(value,size,content,bold),lineHeight=size*.46;
  for(const line of text){ensure(lineHeight+1);font(size,bold,bold?palette.ink:palette.muted);doc.text(line,margin,y+lineHeight);y+=lineHeight;}
  y+=3;
 };
 const section=(title:string)=>{ensure(20);paragraph(title,10,true);};
 const fitValue=(value:string,maxWidth:number,size:number)=>{
  font(size,true);while(size>7&&doc.getTextWidth(value)>maxWidth){size-=.25;font(size,true);}return size;
 };
 const metricLayout=(item:SummaryCard,cardWidth:number,kind?:SummaryIcon,compact=false)=>{
  const textWidth=cardWidth-(kind?15.5:7),labelSize=compact?6.1:6.4,hintSize=compact?5.4:5.7,labelStep=compact?2.6:2.9,hintStep=compact?2.2:2.3,topPadding=compact?3:4,bottomPadding=compact?2:2.5;
  const label=lines(item.label,labelSize,textWidth),hint=lines(item.hint,hintSize,textWidth);
  const size=fitValue(item.value,textWidth,compact?9.8:10.6),value=lines(item.value,size,textWidth,true);
  return {label,hint,size,value,labelSize,hintSize,labelStep,hintStep,topPadding,bottomPadding,height:topPadding+label.length*labelStep+value.length*size*.41+hint.length*hintStep+bottomPadding};
 };
 const metric=(item:SummaryCard,x:number,top:number,cardWidth:number,cardHeight:number,kind?:SummaryIcon,compact=false)=>{
  const dark=item.key==='pending',received=item.key==='received',remaining=item.label==='Falta entregar',textX=x+(kind?12:3.5);
  panel(x,top,cardWidth,cardHeight,dark?palette.dark:remaining?[255,244,242]:received?[237,248,241]:[255,255,255],dark?palette.dark:remaining?[247,192,184]:palette.border);
  if(kind)icon(kind,x+2.5,top+(cardHeight-7.5)/2);
  const {label,hint,size,value,labelSize,hintSize,labelStep,hintStep,topPadding,bottomPadding}=metricLayout(item,cardWidth,kind,compact);
  font(labelSize,false,dark?[255,255,255]:remaining?[180,35,24]:palette.muted);doc.text(label,textX,top+topPadding,{lineHeightFactor:1.2});
  font(size,true,dark?[255,255,255]:remaining?[180,35,24]:received?[25,139,88]:palette.ink);doc.text(value,textX,top+topPadding+label.length*labelStep+size*.3,{lineHeightFactor:1.15});
  font(hintSize,false,dark?[180,210,191]:remaining?[145,57,47]:palette.muted);doc.text(hint,textX,top+cardHeight-bottomPadding-(hint.length-1)*hintStep,{lineHeightFactor:1.15});
 };
 const financialOverviewLayout=()=>{
  const items=summary.financialItems.filter(item=>item.key!=='received'&&item.key!=='pending'&&item.key!=='credit'),gap=2.2,padding=4,cardWidth=(content-padding*2-gap*(items.length-1))/items.length;
  const cards=items.map(item=>{const label=lines(item.label,7,cardWidth-5),hint=lines(item.hint,5.9,cardWidth-5),size=fitValue(item.value,cardWidth-5,10.2),value=lines(item.value,size,cardWidth-5,true);return {item,label,hint,size,value};});
  const cardHeight=Math.max(...cards.map(card=>6+card.label.length*3.1+card.value.length*card.size*.4+card.hint.length*2.6));
  const note=lines(summaryReceivedNote,6.5,content-padding*2),notice=summary.notice?lines(summary.notice,6.5,content-padding*2-6):[];
  const cardsTop=14,noteGap=4,panelHeight=cardsTop+cardHeight+noteGap+note.length*3+(notice.length?notice.length*3+8:0)+3;
  return {gap,padding,cardWidth,cards,cardHeight,note,notice,cardsTop,noteGap,panelHeight};
 };
 const hero=()=>{
  let gap=3,kpiWidth=(content-content*.43-gap*2)/2;
  const overviewWidth=content*.43,copyX=margin+34,copyWidth=overviewWidth-38,valueWidth=(copyWidth-2)/2;
  const quantities=[summary.operationalItems[0],summary.operationalItems[1],summary.operationalItems[3],summary.operationalItems[2]],money=summary.financialItems.filter(item=>item.key==='received'||item.key==='pending'||item.key==='credit'),balances:SummaryCard[]=[
   money[0],money[1],{label:summary.salePerTon.label,value:`Bruto ${summary.salePerTon.gross}`,hint:`Líquido: ${summary.salePerTon.net}`},money[2],
  ];
  const copyValues=[quantities[1],quantities[0]].map(item=>{const size=fitValue(item.value,valueWidth,8.5);return {size,value:lines(item.value,size,valueWidth,true)};});
  const copyExtra=(Math.max(...copyValues.map(item=>item.value.length))-1)*3.5;
  const rowsHeight=(compact=false)=>Math.max(...quantities.map(item=>metricLayout(item,kpiWidth,'scale',compact).height),...balances.map(item=>metricLayout(item,kpiWidth,undefined,compact).height));
  // Reserve the financial panel below the hero, including any pending-data notice.
  const compact=doc.getNumberOfPages()===1&&y+Math.max(60+copyExtra,rowsHeight()*4+gap*3)+financialOverviewLayout().panelHeight+8>bottom;
  if(compact){gap=2;kpiWidth=(content-overviewWidth-gap*2)/2;}
  const heroHeight=Math.max(60+copyExtra,rowsHeight(compact)*4+gap*3),kpiHeight=(heroHeight-gap*3)/4;
  ensure(heroHeight+4);panel(margin,y,overviewWidth,heroHeight,[242,249,245]);
  icon('gauge',margin+4,y+4);font(5.7,true,palette.muted);doc.text('VISÃO OPERACIONAL',margin+14,y+6.5);
  font(8.7,true);doc.text('Avanço do carregamento',margin+14,y+11);
  const statusWidth=Math.max(12,doc.getTextWidth(contract.status)*.65+4),statusX=margin+overviewWidth-statusWidth-4;
  doc.setFillColor(228,242,233);doc.roundedRect(statusX,y+16,statusWidth,5,1.3,1.3,'F');font(6,false,[47,133,84]);doc.text(contract.status,statusX+statusWidth/2,y+19.3,{align:'center'});
  const contracted=Number(summary.totals.contractedVolume),loaded=Number(summary.totals.loadedVolume);
  const percent=contracted>0?Math.max(0,Math.min(100,loaded/contracted*100)):0;
  const cx=margin+17,cy=y+39,radius=14;
  doc.setDrawColor(223,234,227);doc.setLineWidth(2.2);doc.circle(cx,cy,radius,'S');
  if(percent>0){
   doc.setDrawColor(...palette.green);doc.setLineWidth(2.2);doc.setLineCap('round');
   const segments=Math.max(2,Math.ceil(percent/100*100));let previous:[number,number]=[cx,cy-radius];
   for(let index=1;index<=segments;index++){const angle=-Math.PI/2+percent/100*Math.PI*2*index/segments,next:[number,number]=[cx+Math.cos(angle)*radius,cy+Math.sin(angle)*radius];doc.line(previous[0],previous[1],next[0],next[1]);previous=next;}
   doc.setLineCap('butt');
  }
  doc.setFillColor(252,254,252);doc.setDrawColor(...palette.border);doc.setLineWidth(.2);doc.circle(cx,cy,11.6,'FD');
  font(15,true);doc.text(new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(percent)+'%',cx,cy+.7,{align:'center'});font(5.9,false,palette.muted);doc.text('carregado',cx,cy+5,{align:'center'});
  const copy=lines(percent>0?'O contrato já está em andamento.':'O carregamento ainda não foi iniciado.',6.6,copyWidth);
  font(6.6,false,palette.muted);doc.text(copy,copyX,y+29,{lineHeightFactor:1.3});
  ['Carregado','Do contrato'].forEach((label,index)=>{
   const x=copyX+index*(valueWidth+2),{size,value}=copyValues[index];
   font(5.9,false,palette.muted);doc.text(label,x,y+41);
   font(size,true);doc.text(value,x,y+46,{lineHeightFactor:1.2});
  });
  doc.setFillColor(218,234,224);doc.roundedRect(copyX,y+51+copyExtra,copyWidth,1.8,.9,.9,'F');
  if(percent>0){doc.setFillColor(...palette.green);doc.roundedRect(copyX,y+51+copyExtra,Math.max(.5,copyWidth*percent/100),1.8,Math.min(.9,copyWidth*percent/200),.9,'F');}
  quantities.forEach((item,index)=>{
   const top=y+index*(kpiHeight+gap),x=margin+overviewWidth+gap;
   metric(item,x,top,kpiWidth,kpiHeight,(['scale','package','gauge','truck'] as const)[index],compact);
   metric(balances[index],x+kpiWidth+gap,top,kpiWidth,kpiHeight,undefined,compact);
  });
  y+=heroHeight+4;
 };
 const dailyChart=()=>{
  if(!dailyLoads)return;
  const granularity=dailyPeriod?.granularity??'day';
  const granularityCopy=contractDailyLoadGranularityCopy[granularity];
  const rows=contractDailyLoadsChartRows(dailyLoads,granularity),numberLabel=(value:number)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(value);
  const atrValues=rows.map(row=>row.averageAtr).filter((value):value is number=>value!==null&&Number.isFinite(value));
  const atrMinimum=atrValues.length?Math.min(...atrValues):0,atrMaximum=atrValues.length?Math.max(...atrValues):1,atrRange=atrMaximum-atrMinimum;
  const atrPadding=atrRange>0?atrRange*.08:Math.max(Math.abs(atrMaximum)*.03,.5),atrScaleMinimum=atrMinimum-atrPadding,atrScaleMaximum=atrMaximum+atrPadding;
  const period=`${formatContractDate(dailyLoads.filters.from)} a ${formatContractDate(dailyLoads.filters.to)}`;
  const chartInk:Color=[18,18,18],chartSecondary:Color=[45,45,45],chartOrange:Color=[218,123,36];
  const chartHeading=(top:number,padding:number)=>{
   icon('truck',margin+padding,top+4);font(6,true,chartInk);doc.text('EVOLUÇÃO DOS CARREGAMENTOS',margin+padding+10.5,top+6.5);
   font(9.5,true,chartInk);doc.text(granularityCopy.title,margin+padding+10.5,top+11);
  };
  if(!rows.length){
   ensure(34);panel(margin,y,content,30);chartHeading(y,4);
   font(7,false,chartSecondary);doc.text(`Período: ${period} · Nenhum carregamento no período selecionado.`,margin+4,y+23);y+=36;return;
  }
  const pageRows=rows,padding=5,remaining=bottom-y,canUseFirstPageGap=doc.getNumberOfPages()===1&&remaining>=58;
  const panelHeight=canUseFirstPageGap?Math.min(70,remaining):70;
  ensure(panelHeight);panel(margin,y,content,panelHeight);chartHeading(y,padding);
  font(5.8,false,chartSecondary);doc.text(`Barras em toneladas e linha pontilhada do ${granularityCopy.atr.toLowerCase()} · Período: ${period}`,margin+padding,y+14);
  const top=y+17,innerHeight=panelHeight-19,left=margin+padding+15,right=width-margin-padding-12,plotWidth=right-left;
  const metricsY=y+panelHeight-3.5,legendY=metricsY-5,base=legendY-7.5,plotTop=top+4,plotHeight=Math.max(18,base-plotTop),slot=plotWidth/pageRows.length;
  // Draw every bar in one panel; thin labels only when the selected range is dense.
  const labelEvery=Math.max(1,Math.ceil(8/slot)),labelWidth=slot*labelEvery-1;
  const showLabel=(index:number)=>index===pageRows.length-1||(index%labelEvery===0&&pageRows.length-1-index>=labelEvery);
  const chartLabel=(value:string,center:number,labelY:number,startSize:number)=>{
   let size=startSize;font(size,true,chartInk);
   while(size>4.3&&doc.getTextWidth(value)>labelWidth){size=Math.max(4.3,size-.2);font(size,true,chartInk);}
   const halfWidth=doc.getTextWidth(value)/2,labelX=Math.max(left+halfWidth,Math.min(right-halfWidth,center));
   doc.text(value,labelX,labelY,{align:'center'});
  };
  panel(margin+padding,top,content-padding*2,innerHeight,palette.surface);
  const maxVolume=Math.max(1,...pageRows.map(row=>row.volume));
  for(let index=0;index<=3;index++){
   const gridY=base-plotHeight*index/3;doc.setDrawColor(220,228,222);doc.setLineWidth(.2);doc.setLineDashPattern([1,1.4],0);doc.line(left,gridY,right,gridY);doc.setLineDashPattern([],0);
   font(5.6,false,chartSecondary);doc.text(numberLabel(maxVolume*index/3),left-2,gridY+.8,{align:'right'});
  }
  const centers=pageRows.map((_,index)=>left+(index+.5)*slot);
  const atrY=(value:number)=>base-(value-atrScaleMinimum)/(atrScaleMaximum-atrScaleMinimum)*plotHeight;
  const atrPoints=pageRows.map((row,index)=>{const value=row.averageAtr;return value===null||!Number.isFinite(value)?null:{x:centers[index],y:atrY(value),label:`ATR ${formatAtr(row.averageAtrText)}`};});
  const volumeLabelYs=pageRows.map((row,index)=>{
   const labelY=base-row.volume/maxVolume*plotHeight-1.1,point=atrPoints[index];
   return point&&Math.abs(point.y-labelY)<2.5?Math.min(labelY,point.y-3):labelY;
  });
  pageRows.forEach((row,index)=>{
   const center=centers[index],barWidth=Math.min(5.4,slot*.32),barHeight=row.volume/maxVolume*plotHeight;
   doc.setFillColor(84,168,115);doc.roundedRect(center-barWidth/2,base-barHeight,barWidth,barHeight,Math.min(.7,barHeight/2),Math.min(.7,barHeight/2),'F');
   if(showLabel(index)){chartLabel(numberLabel(row.volume),center,volumeLabelYs[index],5.6);chartLabel(row.label,center,base+3.8,5.6);}
  });
  doc.setDrawColor(...chartOrange);doc.setLineWidth(.65);doc.setLineDashPattern([1.2,1],0);let previousAtr:{x:number;y:number}|null=null;
  atrPoints.forEach(point=>{if(!point){previousAtr=null;return;}if(previousAtr)doc.line(previousAtr.x,previousAtr.y,point.x,point.y);previousAtr=point;});doc.setLineDashPattern([],0);
  atrPoints.forEach((point,index)=>{
   if(!point)return;doc.setFillColor(255,255,255);doc.setDrawColor(...chartOrange);doc.circle(point.x,point.y,.9,'FD');
   if(showLabel(index)){
    const labelY=Math.abs(point.y-1.5-volumeLabelYs[index])<2.8?Math.min(base-2,point.y+3.5):point.y-1.5;
    chartLabel(point.label,point.x,labelY,5.3);
   }
  });
  if(atrValues.length){font(5.2,true,chartInk);doc.text(formatAtr(String(atrScaleMaximum)),right+2,plotTop+.8);doc.text(formatAtr(String(atrScaleMinimum)),right+2,base+.8);}
  const quantityLegendX=margin+padding+3;doc.setFillColor(84,168,115);doc.rect(quantityLegendX,legendY-1.6,2.8,2,'F');font(5.3,true,chartInk);doc.text(granularityCopy.quantity,quantityLegendX+4,legendY);
  const atrLegendX=margin+padding+39;doc.setDrawColor(...chartOrange);doc.setLineWidth(.65);doc.setLineDashPattern([1.2,1],0);doc.line(atrLegendX,legendY-1,atrLegendX+7,legendY-1);doc.setLineDashPattern([],0);font(5.3,true,chartInk);doc.text(`${granularityCopy.atr} (kg/t)`,atrLegendX+9,legendY);
  const averageVolume=granularity==='day'?dailyLoads.summary.averageDailyVolume:String(rows.reduce((total,row)=>total+row.volume,0)/rows.length);
  const monthCount=Number(dailyLoads.summary.monthCount),monthMetric=monthCount===1?'1 mês movimentado':`${monthCount} meses movimentados`;
  const metrics=[`Média ${granularityCopy.average} ${formatContractVolume(averageVolume)}`,`Volume ${formatContractVolume(dailyLoads.summary.volume)}`,`ATR médio ${formatAtr(dailyLoads.summary.averageAtr)} kg/t`,monthMetric];
  font(5.3,true,chartInk);doc.text(metrics.join('  ·  '),width-margin-padding-3,metricsY,{align:'right'});
  y+=panelHeight+6;
 };
 const financialOverview=()=>{
  const {gap,padding,cardWidth,cards,cardHeight,note,notice,cardsTop,noteGap,panelHeight}=financialOverviewLayout();
  ensure(panelHeight+4);panel(margin,y,content,panelHeight);heading(margin+padding,y+4,'VISÃO FINANCEIRA · TODO O CONTRATO','Da entrega ao recebimento','money');
  cards.forEach((card,index)=>{
   const x=margin+padding+index*(cardWidth+gap),top=y+cardsTop;panel(x,top,cardWidth,cardHeight,palette.surface);
   font(7,false,palette.muted);doc.text(card.label,x+2.5,top+4.5,{lineHeightFactor:1.25});
   font(card.size,true);doc.text(card.value,x+2.5,top+6+card.label.length*3.1,{lineHeightFactor:1.2});
   font(5.9,false,palette.muted);doc.text(card.hint,x+2.5,top+cardHeight-3-(card.hint.length-1)*2.6,{lineHeightFactor:1.25});
  });
  const noteY=y+cardsTop+cardHeight+noteGap;font(6.5,false,palette.muted);doc.text(note,margin+padding,noteY,{lineHeightFactor:1.3});
  if(notice.length){const noticeY=noteY+note.length*3+2;panel(margin+padding,noticeY,content-padding*2,notice.length*3+5,[251,248,239],[233,223,201]);font(6.5,false,[137,110,60]);doc.text(notice,margin+padding+3,noticeY+4,{lineHeightFactor:1.3});}
  y+=panelHeight+4;
 };
 const charts=()=>{
  const granularity=dailyPeriod?.granularity??'month',granularityCopy=contractDailyLoadGranularityCopy[granularity];
  const numberLabel=(value:number)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(value);
  const moneyLabel=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2}).format(value).replace(/\u00a0/g,' ');
  const periodLabel=dailyPeriod?.from&&dailyPeriod?.to?`${formatContractDate(dailyPeriod.from)} a ${formatContractDate(dailyPeriod.to)}`:effectiveMonthlyPeriod?`${formatContractMonth(effectiveMonthlyPeriod.from)} a ${formatContractMonth(effectiveMonthlyPeriod.to)}`:'Todo o contrato';
  const rows:ContractLoadFinancialChartRow[]=dailyLoads?contractLoadFinancialChartRows(dailyLoads,granularity):filteredMonths.map(row=>{
   const volumeText=row.finance?.loadedVolume??row.production?.loadedVolume??'0',averageAtrText=row.finance?.averageAtr??row.production?.averageLoadAtr??'',averageAtr=Number(averageAtrText);
   const billingPending=row.finance?.billingPending??row.production?.billingPending??false;
   return {key:row.month,date:`${row.month}-01`,endDate:`${row.month}-01`,label:formatContractMonth(row.month),volume:Number(volumeText),volumeText,loadCount:0,averageAtrText,averageAtr:Number.isFinite(averageAtr)&&averageAtr>0?averageAtr:null,gross:billingPending?null:Number(row.finance?.grossAmount??row.production?.billingAmount??0),net:billingPending?null:Number(row.finance?.netAmount??0),billingPending};
  });
  if(!rows.length){
   ensure(34);panel(margin,y,content,30);heading(margin+4,y+4,'RESUMO MENSAL','Entregas, faturamento e entradas','calendar');
   font(7,false,palette.muted);doc.text(`Período: ${periodLabel} · Nenhuma movimentação no período selecionado.`,margin+4,y+23);y+=36;return;
  }
  // The PDF mirrors the single screen filter and keeps every selected bucket readable.
  for(let offset=0;offset<rows.length;offset+=6){
   const pageRows=rows.slice(offset,offset+6);
   const padding=5,panelHeight=87;
   ensure(panelHeight);panel(margin,y,content,panelHeight);
   heading(margin+padding,y+4,'RESUMO MENSAL','Entregas, faturamento e entradas','calendar');
   const criterion='ATR '+formatAtrCriterion(contract.atrPriceType,contract.atrPeriodType);font(6.2,false,[47,133,84]);
   const criterionWidth=doc.getTextWidth(criterion)+5;
   doc.setFillColor(235,246,239);doc.roundedRect(width-margin-padding-criterionWidth,y+5,criterionWidth,5.5,1.3,1.3,'F');doc.text(criterion,width-margin-padding-2.5,y+8.6,{align:'right'});
   const top=y+17,left=margin+padding+24,right=width-margin-padding-5,plotWidth=right-left,base=top+44.5,plotHeight=33.5,slot=plotWidth/pageRows.length;
   const chartInk:Color=[22,28,24];
   panel(margin+padding,top,content-padding*2,63,palette.surface);font(7.5,true,chartInk);doc.text(`Faturamento bruto e líquido por ${granularityCopy.noun}`,margin+padding+3,top+5);font(5.7,true,chartInk);doc.text(`Barra total: faturado bruto · Preenchimento interno: líquido · Período: ${periodLabel}`,margin+padding+3,top+8.6);
   const hasPositiveGross=pageRows.some(row=>row.gross!==null&&Number.isFinite(row.gross)&&row.gross>0);
   const maximum=hasPositiveGross?Math.max(...pageRows.map(row=>row.gross??0)):0;
   const magnitude=hasPositiveGross?10**Math.floor(Math.log10(maximum)):1,scaleStep=magnitude/10,scale=hasPositiveGross?Math.ceil(maximum*1.12/scaleStep)*scaleStep:1;
   const centeredChartLabel=(value:string,x:number,labelY:number,maxWidth:number,startSize:number,minSize:number,color:Color=chartInk)=>{
    let size=startSize;font(size,true,color);while(size>minSize&&doc.getTextWidth(value)>maxWidth){size=Math.max(minSize,size-.2);font(size,true,color);}doc.text(value,x,labelY,{align:'center'});
   };
   for(let index=0;index<=4;index++){
    const gridY=base-plotHeight*index/4;doc.setDrawColor(227,237,231);doc.setLineWidth(.2);doc.setLineDashPattern([1,1.4],0);doc.line(left,gridY,right,gridY);doc.setLineDashPattern([],0);
    if(hasPositiveGross||index===0){font(5.3,true,chartInk);doc.text(moneyLabel(hasPositiveGross?scale*index/4:0),left-2,gridY+.8,{align:'right'});}
   }
   const centers=pageRows.map((_,index)=>left+(index+.5)*slot);
   pageRows.forEach((row,index)=>{
    const center=centers[index],barWidth=Math.min(11.5,slot*.44),barX=center-barWidth/2;
    if(row.gross!==null&&Number.isFinite(row.gross)&&row.gross>0){
     const grossHeight=row.gross/scale*plotHeight;
     const radius=Math.min(.9,barWidth/8,grossHeight/2);
     doc.setFillColor(180,218,194);doc.setDrawColor(74,139,96);doc.setLineWidth(.32);doc.roundedRect(barX,base-grossHeight,barWidth,grossHeight,radius,radius,'FD');
     if(row.net!==null&&Number.isFinite(row.net)){
      const netHeight=Math.min(grossHeight,Math.max(0,row.net)/scale*plotHeight),netRadius=Math.min(.9,barWidth/8,netHeight/2);
      if(netHeight>0){doc.setFillColor(...palette.dark);doc.roundedRect(barX,base-netHeight,barWidth,netHeight,netRadius,netRadius,'F');}
     }
     doc.setDrawColor(74,139,96);doc.setLineWidth(.32);doc.roundedRect(barX,base-grossHeight,barWidth,grossHeight,radius,radius,'S');
     centeredChartLabel(`Bruto ${moneyLabel(row.gross)}`,center,base-grossHeight-1,slot-1,5.1,4.4);
    }else if(row.gross===null){
     doc.setDrawColor(...palette.amber);doc.setLineWidth(.45);doc.setLineDashPattern([1,1],0);doc.line(barX,base-.3,barX+barWidth,base-.3);doc.setLineDashPattern([],0);
     centeredChartLabel('Faturamento pendente',center,base-2,slot-1,4.8,4.2,[126,73,18]);
    }
    else{
     doc.setFillColor(225,239,230);doc.setDrawColor(74,139,96);doc.setLineWidth(.3);doc.roundedRect(barX,base-1.1,barWidth,1.1,.35,.35,'FD');
     centeredChartLabel(`Bruto ${moneyLabel(0)}`,center,base-2.2,slot-1,4.8,4.2);
    }
    font(5.6,true,chartInk);doc.text(row.label,center,base+3.6,{align:'center'});font(5,true,chartInk);doc.text(`${numberLabel(row.volume)} t`,center,base+6.2,{align:'center'});
    const netLabel=row.gross===null?'Líquido pendente':`Líquido ${moneyLabel(row.net??0)}`;
    centeredChartLabel(netLabel,center,base+8.8,slot-1,4.9,4.3,row.gross===null?[126,73,18]:chartInk);
   });
   const legendY=top+60;doc.setFillColor(180,218,194);doc.setDrawColor(74,139,96);doc.rect(margin+padding+3,legendY-1.7,3.2,2.1,'FD');font(5.4,true,chartInk);doc.text('Faturado bruto (barra total)',margin+padding+7.3,legendY);
   const legendX=margin+padding+51;doc.setFillColor(...palette.dark);doc.rect(legendX,legendY-1.7,3.2,2.1,'F');font(5.4,true,chartInk);doc.text('Líquido (preenchimento interno)',legendX+4.3,legendY);
   y+=panelHeight+6;
  }
 };
 const table=(model:SummaryTable)=>{
  const widths=model.widths.map(part=>part*content),lineHeight=3.4;
  font(7,true);const headers=model.columns.map((label,index)=>doc.splitTextToSize(label,widths[index]-4) as string[]);
  const headerHeight=Math.max(...headers.map(text=>text.length))*lineHeight+4;
  const header=(continued=false,firstRowSpace=12)=>{
   const descriptionHeight=continued?0:lines(model.description,7,content).length*3.22+3;
   ensure(7.6+descriptionHeight+headerHeight+firstRowSpace);
   section(model.title+(continued?' (continuação)':''));
   if(!continued)paragraph(model.description,7);
   doc.setFillColor(239,246,242);doc.rect(margin,y,content,headerHeight,'F');font(7,true);
   let x=margin;headers.forEach((text,index)=>{doc.text(text,x+2,y+4,{lineHeightFactor:1.35});x+=widths[index];});y+=headerHeight;
  };
  if(!model.rows.length){section(model.title);paragraph(model.empty,8);return;}
  const firstRowHeight=Math.max(...model.rows[0].map((value,index)=>lines(value,7,widths[index]-4).length))*lineHeight+4;
  header(false,Math.min(firstRowHeight,30));
  model.rows.forEach((row,rowIndex)=>{
   font(7);const cells=row.map((value,index)=>doc.splitTextToSize(value,widths[index]-4) as string[]);
   const totalLines=Math.max(...cells.map(text=>text.length));let offset=0;
   if(y+Math.min(totalLines*lineHeight+4,30)>bottom){newPage();header(true);}
   while(offset<totalLines){
    if(y+lineHeight+4>bottom){newPage();header(true);}
    const fitting=Math.max(1,Math.floor((bottom-y-4)/lineHeight)),count=Math.min(fitting,totalLines-offset),rowHeight=count*lineHeight+4;
    if(rowIndex%2){doc.setFillColor(249,252,250);doc.rect(margin,y,content,rowHeight,'F');}
    font(7);let x=margin;
    cells.forEach((text,index)=>{const part=text.slice(offset,offset+count);if(part.length)doc.text(part,x+2,y+4,{lineHeightFactor:1.37});x+=widths[index];});
    doc.setDrawColor(228,237,231);doc.setLineWidth(.2);doc.line(margin,y+rowHeight,width-margin,y+rowHeight);y+=rowHeight;offset+=count;
   }
  });
  y+=7;
 };

 startPage();
 hero();
 financialOverview();
 dailyChart();
 charts();
 const periodTables=summary.tables.map((model,index)=>index<2&&effectiveMonthlyPeriod?{...model,rows:model.rows.filter((_,rowIndex)=>monthIsInContractPeriod(summary.months[rowIndex]?.month??'',effectiveMonthlyPeriod))}:model);
 for(const model of periodTables)table(model);
 if(contract.notes.trim()){section('Observações do contrato');paragraph(contract.notes,8);}

 const pages=doc.getNumberOfPages();
 for(let page=1;page<=pages;page++){
  doc.setPage(page);const footerY=height-margin+2;doc.setDrawColor(225,232,227);doc.line(margin,footerY-5,width-margin,footerY-5);font(7,false,palette.muted);
  const issued=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(brand.issuedAt);
  const footer=doc.splitTextToSize(`Emitido por ${brand.issuer.name||brand.issuer.email} em ${issued}`,content-32)[0];doc.text(footer,margin,footerY);doc.text(`Página ${page} de ${pages}`,width-margin,footerY,{align:'right'});
 }
 return {doc,fileName:`resumo-contrato-${contract.id.slice(0,8)}-${brand.issuedAt.toISOString().slice(0,10)}.pdf`};
}
