import type {jsPDF} from 'jspdf';
import type {BillingContract,ContractListSummary} from '../types';

type Context={doc:jsPDF;x:number;y:number;width:number;height:number};
type Data={contracts:BillingContract[];summary:ContractListSummary;total:number};
type Color=[number,number,number];
const C={forest:[21,61,44] as Color,ink:[24,48,37] as Color,muted:[88,105,95] as Color,
 border:[217,229,221] as Color,paper:[247,250,248] as Color,white:[255,255,255] as Color,
 contracted:[169,188,178] as Color,loaded:[31,116,73] as Color,remaining:[106,146,157] as Color,
 amber:[170,110,30] as Color,amberPaper:[253,247,234] as Color,quote:[63,119,133] as Color};
const value=(raw:unknown):number|null=>raw===null||raw===undefined||raw===''?null:Number.isFinite(Number(raw))?Number(raw):null;
const number=(amount:number|null,digits=2)=>amount===null?'n/d':amount.toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const percentage=(raw:unknown)=>{const amount=value(raw);return amount===null?'n/d':number(amount)+'%';};
const reference=(index:number)=>`C${String(index+1).padStart(2,'0')}`;
const date=(raw:string)=>/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw.split('-').reverse().join('/'):'Data não informada';
const quote=(contract:BillingContract)=>contract.atrQuoteSummary?.pending?null:value(contract.atrQuoteSummary?.average);

function text(doc:jsPDF,label:string,x:number,y:number,size=7,color=C.ink,bold=false,align:'left'|'right'|'center'='left'){
 doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);doc.text(label,x,y,{align});
}
function fit(doc:jsPDF,label:string,x:number,y:number,width:number,size=8,color=C.ink,bold=false){
 doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);
 const scaled=Math.max(6,Math.min(size,size*width/Math.max(doc.getTextWidth(label),.1)));
 doc.setFontSize(scaled);
 let shown=label;
 while(shown.length>1&&doc.getTextWidth(shown)>width)shown=shown.slice(0,-2)+'…';
 text(doc,shown,x,y,scaled,color,bold);
}
function box(doc:jsPDF,x:number,y:number,width:number,height:number,fill=C.paper){
 doc.setFillColor(...fill);doc.setDrawColor(...C.border);doc.setLineWidth(.2);doc.roundedRect(x,y,width,height,1.5,1.5,'FD');
}
function track(doc:jsPDF,x:number,y:number,width:number,amount:number|null,maximum:number,color:Color,height=1.5){
 doc.setFillColor(...C.border);doc.rect(x,y,width,height,'F');
 if(amount===null)return;
 doc.setFillColor(...color);doc.rect(x,y,Math.max(0,Math.min(width,amount/maximum*width)),height,'F');
}
function heading(ctx:Context,data:Data){
 const {doc,x,y,width}=ctx;
 doc.setFillColor(...C.forest);doc.roundedRect(x,y,width,14,1.5,1.5,'F');
 text(doc,'OPERAÇÃO E QUALIDADE',x+4,y+4.5,6.5,[196,219,205],true);
 text(doc,'Volumes e ATR dos contratos',x+4,y+10.6,13,C.white,true);
 text(doc,'Comparativo operacional',x+width-4,y+9.5,7,[218,234,224],false,'right');
 const top=y+17,first=width*.39,second=width*.39;
 text(doc,'VOLUME CARREGADO',x+3,top+3,6.5,C.muted,true);
 fit(doc,`${number(value(data.summary.loadedVolume))} t`,x+3,top+10,first-6,16,C.loaded,true);
 text(doc,'Total oficial dos contratos filtrados',x+3,top+14.5,6,C.muted);
 doc.setFillColor(...C.amberPaper);doc.roundedRect(x+first,top-1,second,18,1,1,'F');
 text(doc,'ATR MÉDIO PONDERADO',x+first+4,top+3,6.5,C.amber,true);
 fit(doc,`${number(value(data.summary.averageAtr),4)} kg/t`,x+first+4,top+10,second-8,16,C.amber,true);
 text(doc,'Ponderado pelas toneladas carregadas',x+first+4,top+14.5,6,C.muted);
 const lastX=x+first+second+5;
 text(doc,'CONTRATOS',lastX,top+3,6.5,C.muted,true);
 text(doc,String(data.total),lastX,top+10,16,C.forest,true);
 text(doc,'No filtro selecionado',lastX,top+14.5,6,C.muted);
 doc.setDrawColor(...C.border);doc.setLineWidth(.2);doc.line(x,y+37,x+width,y+37);
}

function compactRows(ctx:Context,contracts:BillingContract[]){
 const {doc,x,y,width,height}=ctx;
 const identity=width*.285,volumeWidth=width*.365,atrWidth=width*.175;
 const volumeX=x+identity,atrX=volumeX+volumeWidth,quoteX=atrX+atrWidth;
 text(doc,'IDENTIFICAÇÃO',x+3,y+3,6.5,C.muted,true);
 text(doc,'QUANTIDADES · t',volumeX+3,y+3,6.5,C.muted,true);
 text(doc,'ATR · kg/t',atrX+3,y+3,6.5,C.amber,true);
 text(doc,'COTAÇÃO · R$/kg ATR',quoteX+3,y+3,6,C.quote,true);
 const rowsTop=y+7,rowHeight=Math.min(30,(height-7)/contracts.length);
 const maximumVolume=Math.max(1,...contracts.flatMap(c=>[value(c.contractedVolume)??0,value(c.loadedVolume)??0,value(c.remainingVolume)??0]));
 const maximumAtr=Math.max(1,...contracts.map(c=>value(c.averageAtr)??0));
 const maximumQuote=Math.max(1,...contracts.map(c=>quote(c)??0));
 contracts.forEach((contract,index)=>{
  const top=rowsTop+index*rowHeight,inner=Math.min(4,rowHeight*.17),center=top+rowHeight/2;
  doc.setFillColor(...(index%2?C.paper:C.white));doc.rect(x,top,width,rowHeight,'F');
  doc.setFillColor(...C.amberPaper);doc.rect(atrX,top,atrWidth,rowHeight,'F');
  fit(doc,`${reference(index)} · ${contract.typeName||'Tipo não informado'}`,x+3,center-3.5,identity-6,8,C.forest,true);
  fit(doc,contract.clientName||'Cliente não informado',x+3,center+.4,identity-6,7,C.ink);
  fit(doc,`${date(contract.startDate)} · Contrato ${contract.contractNumber||'sem número'}`,x+3,center+4.2,identity-6,6.5,C.muted);
  const percentages=contract.operationalPercentages;
  const entries=[['Contratado',value(contract.contractedVolume),C.contracted,percentages?.contracted],['Carregado',value(contract.loadedVolume),C.loaded,percentages?.loaded],['Pendente',value(contract.remainingVolume),C.remaining,percentages?.remaining]] as const;
  entries.forEach(([label,amount,color,percent],row)=>{
   const at=center+(row-1)*Math.min(5.5,(rowHeight-2*inner)/3);
   text(doc,label,volumeX+3,at+1,6.3,C.muted);
   const trackX=volumeX+22,trackWidth=Math.max(8,volumeWidth-67);
   track(doc,trackX,at-.4,trackWidth,amount,maximumVolume,color,1.8);
   text(doc,percentage(percent),volumeX+volumeWidth-29,at+1,6.3,color===C.loaded?C.loaded:C.muted,true,'right');
   text(doc,number(amount),volumeX+volumeWidth-3,at+1,6.8,color===C.loaded?C.loaded:C.ink,true,'right');
  });
  fit(doc,number(value(contract.averageAtr),4),atrX+3,center-.5,atrWidth-6,11,C.amber,true);
  track(doc,atrX+3,center+2.5,atrWidth-6,value(contract.averageAtr),maximumAtr,C.amber);
  const quoteWidth=x+width-quoteX;
  fit(doc,contract.atrQuoteSummary?.pending?'Pendente':number(quote(contract),4),quoteX+3,center-.5,quoteWidth-6,10,C.quote,true);
  track(doc,quoteX+3,center+2.5,quoteWidth-6,quote(contract),maximumQuote,C.quote);
  fit(doc,`${contract.atrPriceType==='net'?'Líquido':'Bruto'} · ${contract.atrPeriodType==='monthly'?'Mensal':'Acumulado'}`,quoteX+3,center+6.5,quoteWidth-6,6,C.muted);
  doc.setDrawColor(...C.border);doc.setLineWidth(.2);doc.line(x,top+rowHeight,x+width,top+rowHeight);
 });
}

type Series={label:string;color:Color;values:(number|null)[]};
function denseChart(ctx:Context,title:string,unit:string,series:Series[],contracts:BillingContract[]){
 const {doc,x,y,width,height}=ctx;box(doc,x,y,width,height);
 text(doc,title,x+3,y+5,8,C.ink,true);text(doc,unit,x+3,y+9,6,C.muted);
 let legendX=x+3;
 series.forEach(entry=>{doc.setFillColor(...entry.color);doc.rect(legendX,y+12,1.7,1.7,'F');text(doc,entry.label,legendX+2.5,y+13.5,6,C.muted);legendX+=doc.getTextWidth(entry.label)+7;});
 const left=x+11,right=x+width-3,top=y+20,bottom=y+height-12;
 const maximum=Math.max(1,...series.flatMap(entry=>entry.values.map(amount=>amount??0)))*1.08;
 for(let tick=0;tick<=3;tick++){
  const amount=maximum*tick/3,at=bottom-(bottom-top)*tick/3;
  doc.setDrawColor(...C.border);doc.setLineWidth(.15);doc.line(left,at,right,at);
  const label=amount>=1000?`${number(amount/1000,1)}k`:number(amount,amount<2?1:0);
  text(doc,label,left-1,at+.8,6,C.muted,false,'right');
 }
 const slot=(right-left)/contracts.length,barWidth=Math.min(4,slot*.78/series.length);
 series.forEach((entry,seriesIndex)=>entry.values.forEach((amount,index)=>{
  const at=left+slot*(index+.5)+(seriesIndex-series.length/2)*barWidth;
  if(amount===null){doc.setDrawColor(...C.muted);doc.setLineWidth(.25);doc.line(at,bottom-1,at+Math.max(.3,barWidth*.8),bottom-1);return;}
  const barHeight=Math.max(0,(bottom-top)*amount/maximum);
  doc.setFillColor(...entry.color);doc.rect(at,bottom-barHeight,barWidth*.86,barHeight,'F');
 }));
 const every=Math.max(1,Math.ceil(3/slot));
 contracts.forEach((_,index)=>{
  if(index%every!==0&&index!==contracts.length-1)return;
  if(index!==contracts.length-1&&contracts.length-1-index<every)return;
  doc.setFont('helvetica','normal');doc.setFontSize(6);doc.setTextColor(...C.muted);
  doc.text(reference(index),left+slot*(index+.5)+.7,bottom+9,{angle:90});
 });
 return every>1;
}

/** Geometry and formatting only: all operational values come from the RPC. */
export function drawContractsOperationalPdf(ctx:Context,data:Data):void{
 const {doc,x,y,width,height}=ctx;heading(ctx,data);
 const content={doc,x,y:y+41,width,height:height-52};
 let sampled=false;
 if(!data.contracts.length){box(doc,x,content.y,width,content.height);text(doc,'Nenhum contrato encontrado para os filtros selecionados.',x+5,content.y+12,9,C.muted);}
 else if(data.contracts.length<=6&&(content.height-7)/data.contracts.length>=15)compactRows(content,data.contracts);
 else{
  const gap=3,volumeWidth=width*.52,other=(width-volumeWidth-gap*2)/2;
  sampled=denseChart({...content,width:volumeWidth},'Quantidades por contrato','toneladas',[
   {label:'Contratado',color:C.contracted,values:data.contracts.map(c=>value(c.contractedVolume))},
   {label:'Carregado',color:C.loaded,values:data.contracts.map(c=>value(c.loadedVolume))},
   {label:'Pendente',color:C.remaining,values:data.contracts.map(c=>value(c.remainingVolume))},
  ],data.contracts)||sampled;
  sampled=denseChart({...content,x:x+volumeWidth+gap,width:other},'ATR médio','kg ATR/t',[
   {label:'ATR do contrato',color:C.amber,values:data.contracts.map(c=>value(c.averageAtr))},
  ],data.contracts)||sampled;
  sampled=denseChart({...content,x:x+volumeWidth+other+gap*2,width:other},'Cotação média','R$/kg ATR',[
   {label:'Cotação aplicada',color:C.quote,values:data.contracts.map(c=>quote(c))},
  ],data.contracts)||sampled;
 }
 const note=sampled?'Todos os contratos representados; apenas rótulos amostrados. C01... identifica os contratos na tabela anterior.':'C01... identifica os contratos na tabela anterior. ATR medido e cotação aplicada têm unidades e escalas diferentes.';
 text(doc,note,x,y+height-5,6,C.muted);
 text(doc,'ATR ponderado pelo volume. Pendente: volume a carregar. Barras em escala comum (t); percentuais sobre o contratado de cada contrato. n/d = dado não disponível.',x,y+height-1,6,C.muted);
}
