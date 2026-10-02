import type {jsPDF as JsPdf} from 'jspdf';
import type {ContractDailyLoadsChartRow,ContractLoadFinancialChartRow} from '../utils/contractDailyLoadsPresentation';

type Color=[number,number,number];
type ChartCopy={title:string;quantity:string;atr:string;noun:string};
export type ContractPdfChartContext={doc:JsPdf;x:number;y:number;width:number;height:number};
type ValueRow={label:string;values:string[];color?:Color;background?:Color};
const colors={ink:[23,37,29],muted:[74,91,80],grid:[222,233,225],green:[84,168,115],net:[31,116,73],orange:[217,119,6]} satisfies Record<string,Color>;
const number=(value:number)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(value);
const money=(value:number)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);

function font(doc:JsPdf,size:number,bold=false,color:Color=colors.ink){
 doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);
}

function label(doc:JsPdf,value:string,x:number,y:number,width:number,size=7,color:Color=colors.ink){
 font(doc,size,true,color);
 const measured=doc.getTextWidth(value);
 if(measured>width)font(doc,Math.max(4.5,size*width/measured),true,color);
 doc.text(value,x,y,{align:'center'});
}

function labelDensity(count:number,width:number){
 const slot=width/Math.max(1,count),every=Math.max(1,Math.ceil(2.4/slot));
 const visible=(index:number)=>index===count-1||(index%every===0&&count-1-index>=every);
 return {slot,every,visible:every===1?()=>true:visible};
}

// Every bucket remains plotted. Only labels are sampled below the readable width.
function valueBand(ctx:ContractPdfChartContext,rows:ValueRow[],left:number,right:number,bottom:number){
 const {doc}=ctx,count=rows[0]?.values.length??0;
 const {slot,every,visible}=labelDensity(count,right-left);
 const size=Math.min(7,Math.max(4.8,slot*every*1.8));
 font(doc,size,true);
 const rotated=rows.some(row=>row.values.some(value=>doc.getTextWidth(value)>slot-1.2));
 const heights=rows.map(row=>rotated?Math.max(10,...row.values.map(value=>doc.getTextWidth(value)+4)):7);
 const top=bottom-heights.reduce((total,height)=>total+height,0);
 let y=top;
 rows.forEach((row,rowIndex)=>{
  const height=heights[rowIndex];
  const background:Color=row.background??(rowIndex%2?[247,250,248]:[240,247,242]);
  doc.setFillColor(...background);
  doc.rect(left,y,right-left,height,'F');
  font(doc,6,true,row.color??colors.muted);
  doc.text(row.label,left-2,y+height/2+1,{align:'right'});
  row.values.forEach((value,index)=>{
   if(!visible(index))return;
   const center=left+(index+.5)*slot;
   font(doc,size,true,row.color??colors.ink);
   if(rotated){
    const textX=Math.max(left+size*.3528,Math.min(right,center+size*.12));
    doc.text(value,textX,y+height/2+doc.getTextWidth(value)/2,{angle:90,align:'left'});
   }
   else doc.text(value,center,y+height/2+1,{align:'center'});
  });
  y+=height;
 });
 return {top,slot,rotated,every};
}

function densityNote(ctx:ContractPdfChartContext,count:number,every:number,y:number){
 if(every===1)return;
 font(ctx.doc,5.8,false,colors.muted);
 ctx.doc.text(`Todos os ${count} períodos estão representados; rótulos a cada ${every} períodos. Consulte os valores completos na tela.`,ctx.x+5,y);
}

function frame(ctx:ContractPdfChartContext,kicker:string,title:string,subtitle:string){
 const {doc,x,y,width,height}=ctx;
 doc.setLineWidth(.2);doc.setDrawColor(...colors.grid);doc.setFillColor(255,255,255);
 doc.roundedRect(x,y,width,height,2.2,2.2,'FD');
 doc.setFillColor(...colors.green);doc.roundedRect(x+5,y+5,1.2,10,.6,.6,'F');
 font(doc,6.5,true,colors.muted);doc.text(kicker,x+9,y+7);
 font(doc,11,true);doc.text(title,x+9,y+13);
 font(doc,6.5,false,colors.muted);doc.text(subtitle,x+5,y+19);
}

function grid(ctx:ContractPdfChartContext,left:number,right:number,top:number,base:number,maximum:number,format:(value:number)=>string){
 const {doc}=ctx;
 for(let index=0;index<=4;index++){
  const y=base-(base-top)*index/4;
  doc.setDrawColor(...colors.grid);doc.setLineWidth(.2);doc.setLineDashPattern([1,1.4],0);
  doc.line(left,y,right,y);doc.setLineDashPattern([],0);
  font(doc,6,false,colors.muted);doc.text(format(maximum*index/4),left-2,y+.8,{align:'right'});
 }
}

function bar(doc:JsPdf,center:number,base:number,width:number,height:number,color:Color){
 if(height<=0)return;
 const radius=Math.min(.8,width/4,height/2);
 doc.setFillColor(...color);doc.roundedRect(center-width/2,base-height,width,height,radius,radius,'F');
}

function legend(doc:JsPdf,x:number,y:number,text:string,color:Color,line=false){
 doc.setFillColor(...color);doc.setDrawColor(...color);
 if(line){
  doc.setLineWidth(.6);doc.setLineDashPattern([1.2,1],0);doc.line(x,y-1,x+6,y-1);doc.setLineDashPattern([],0);
 }else doc.rect(x,y-2.1,3,2.6,'F');
 font(doc,6.5,true);doc.text(text,x+(line?8:5),y);
}

export function drawContractLoadPdfChart(ctx:ContractPdfChartContext,rows:ContractDailyLoadsChartRow[],copy:ChartCopy,period:string,metrics:string){
 const {doc,x,y,width,height}=ctx;
 frame(ctx,'EVOLUÇÃO DOS CARREGAMENTOS',copy.title,`Período: ${period} · Toneladas e ${copy.atr.toLowerCase()} (kg/t)`);
 if(!rows.length){font(doc,9,false,colors.muted);doc.text('Nenhum carregamento no período selecionado.',x+5,y+32);return;}
 const left=x+24,right=x+width-18;
 const sampled=labelDensity(rows.length,right-left).every>1;
 const band=valueBand(ctx,[
  {label:'Data',values:rows.map(row=>row.label)},
  {label:'Volume (t)',values:rows.map(row=>number(row.volume))},
  {label:'ATR (kg/t)',values:rows.map(row=>row.averageAtr===null?'—':number(row.averageAtr)),color:[152,75,4],background:[255,243,228]},
 ],left,right,y+height-(sampled?24:19));
 const base=band.top-4,top=y+29,plotHeight=base-top,slot=band.slot;
 const maxVolume=Math.max(1,...rows.map(row=>row.volume))*1.12;
 grid(ctx,left,right,top,base,maxVolume,number);
 font(doc,6,true,colors.muted);doc.text('Toneladas',left,top-3);doc.text('ATR kg/t',right,top-3,{align:'right'});
 const atrValues=rows.flatMap(row=>row.averageAtr!==null&&Number.isFinite(row.averageAtr)?[row.averageAtr]:[]);
 const minimum=atrValues.length?Math.min(...atrValues):0,maximum=atrValues.length?Math.max(...atrValues):1;
 const padding=Math.max((maximum-minimum)*.12,Math.abs(maximum)*.015,.5),atrMin=minimum-padding,atrMax=maximum+padding;
 const points=rows.map((row,index)=>({x:left+(index+.5)*slot,y:row.averageAtr===null?null:base-(row.averageAtr-atrMin)/(atrMax-atrMin)*plotHeight}));
 rows.forEach((row,index)=>{
  const center=points[index].x,barHeight=row.volume/maxVolume*plotHeight;
  bar(doc,center,base,Math.min(8.5,slot*.38),barHeight,colors.green);
  // Readable value bands carry exact labels; dense periods disclose sampling.
  if(!band.rotated)label(doc,number(row.volume),center,base-barHeight-2,slot-1,7);
 });
 doc.setDrawColor(...colors.orange);doc.setLineWidth(.6);doc.setLineDashPattern([1.3,1],0);
 let previous:typeof points[number]|null=null;
 points.forEach(point=>{
  if(point.y===null){previous=null;return;}
  if(previous&&previous.y!==null)doc.line(previous.x,previous.y,point.x,point.y);
  previous=point;
 });
 doc.setLineDashPattern([],0);
 points.forEach(point=>{
  if(point.y===null)return;
  doc.setFillColor(255,255,255);doc.setDrawColor(...colors.orange);doc.circle(point.x,point.y,Math.min(.85,slot*.14),'FD');
 });
 if(atrValues.length){
  font(doc,5.8,false,colors.orange);
  doc.text(number(atrMax),right+2,top+1);doc.text(number(atrMin),right+2,base+1);
 }
 legend(doc,x+5,y+height-12,copy.quantity,colors.green);
 legend(doc,x+70,y+height-12,copy.atr,colors.orange,true);
 densityNote(ctx,rows.length,band.every,y+height-18);
 label(doc,metrics,x+width/2,y+height-5,width-10,6.3,colors.muted);
}

export function drawContractFinancialPdfChart(ctx:ContractPdfChartContext,rows:ContractLoadFinancialChartRow[],copy:ChartCopy,period:string,criterion:string){
 const {doc,x,y,width,height}=ctx;
 frame(ctx,'ENTREGAS E FATURAMENTO',`Faturamento bruto e líquido por ${copy.noun}`,`Período: ${period} · ${criterion} · Valores em R$`);
 if(!rows.length){font(doc,9,false,colors.muted);doc.text('Nenhuma movimentação no período selecionado.',x+5,y+32);return;}
 const left=x+29,right=x+width-8;
 const sampled=labelDensity(rows.length,right-left).every>1;
 const band=valueBand(ctx,[
  {label:'Data',values:rows.map(row=>row.label)},
  {label:'Bruto (R$)',values:rows.map(row=>row.gross===null?'Pendente':money(row.gross))},
  {label:'Líquido (R$)',values:rows.map(row=>row.gross===null||row.net===null?'Pendente':money(row.net)),color:colors.net},
  {label:'Volume (t)',values:rows.map(row=>number(row.volume))},
 ],left,right,y+height-(sampled?18:13));
 const base=band.top-4,top=y+29,plotHeight=base-top,slot=band.slot;
 const maximum=Math.max(0,...rows.map(row=>row.gross??0));
 const scale=maximum>0?maximum*1.15:1;
 grid(ctx,left,right,top,base,scale,value=>maximum>0||value===0?`R$ ${money(maximum>0?value:0)}`:'');
 rows.forEach((row,index)=>{
  const center=left+(index+.5)*slot,barWidth=Math.min(8.5,slot*.38);
  if(row.gross===null){
   doc.setDrawColor(...colors.orange);doc.setLineWidth(.5);doc.setLineDashPattern([1,1],0);
   doc.line(center-barWidth/2,base-.3,center+barWidth/2,base-.3);doc.setLineDashPattern([],0);return;
  }
  const grossHeight=Math.max(0,row.gross)/scale*plotHeight;
  bar(doc,center,base,barWidth,Math.max(.4,grossHeight),colors.green);
  if(row.net!==null)bar(doc,center,base,barWidth,Math.min(grossHeight,Math.max(0,row.net)/scale*plotHeight),colors.net);
  if(!band.rotated)label(doc,money(row.gross),center,base-grossHeight-2,slot-1,6.5);
 });
 legend(doc,x+5,y+height-5,'Faturado bruto (barra total)',colors.green);
 legend(doc,x+80,y+height-5,'Líquido (preenchimento interno)',colors.net);
 densityNote(ctx,rows.length,band.every,y+height-12);
}
