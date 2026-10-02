import type {jsPDF as JsPdf} from 'jspdf';
import type {ContractFarmTotals} from '../types';
import type {ContractPdfChartContext} from './contractSummaryPdfCharts';

type Color=[number,number,number];
const palette={ink:[23,37,29],muted:[74,91,80],border:[222,233,225],volume:[108,151,112],gross:[84,168,115],net:[31,116,73],pending:[152,75,4]} satisfies Record<string,Color>;
const numeric=(value:string)=>value.trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
const number=(value:string)=>numeric(value)===null?'Pendente':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(value));
const money=(value:string)=>numeric(value)===null?'Pendente':new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));

function font(doc:JsPdf,size:number,bold=false,color:Color=palette.ink){
 doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);
}

function fit(doc:JsPdf,value:string,width:number,size:number){
 font(doc,size,true);
 const measured=doc.getTextWidth(value);
 if(measured>width)font(doc,Math.max(4.4,size*width/measured),true);
}

function clipped(doc:JsPdf,value:string,width:number){
 if(doc.getTextWidth(value)<=width)return value;
 let end=value.length;
 while(end>1&&doc.getTextWidth(value.slice(0,end)+'…')>width)end--;
 return value.slice(0,end)+'…';
}

function singleFarm(ctx:ContractPdfChartContext,row:ContractFarmTotals){
 const {doc,x,y,width,height}=ctx;
 const left=x+5,top=y+25,inner=width-10;
 const white:Color=[255,255,255],forest:Color=[21,64,44];
 const available=height-37,header=20,metricsHeight=25;
 doc.setFillColor(...forest);doc.roundedRect(left,top,inner,header,2,2,'F');
 font(doc,6,true,[174,211,184]);doc.text('FAZENDA EM DESTAQUE',left+5,top+6);
 font(doc,13,true,white);
 const name=row.name||'Fazenda não informada';
 const nameWidth=inner-48;
 fit(doc,name,nameWidth,13);doc.setTextColor(...white);
 doc.text(clipped(doc,name,nameWidth),left+5,top+14);
 font(doc,7,true,white);
 doc.text(`${row.loadCount} ${row.loadCount===1?'carregamento':'carregamentos'}`,left+inner-5,top+12,{align:'right'});

 const metricTop=top+header+3,cell=(inner-6)/3;
 const items=[
  {label:'QUANTIDADE ENTREGUE',value:number(row.volume),unit:'toneladas',color:palette.volume},
  {label:'FATURAMENTO BRUTO',value:row.billingPending?'Pendente':money(row.grossAmount),unit:'R$',color:palette.gross},
  {label:'VALOR LÍQUIDO',value:row.billingPending?'Pendente':money(row.netAmount),unit:'R$',color:palette.net},
 ];
 items.forEach((item,index)=>{
  const cellX=left+index*(cell+3);
  doc.setFillColor(...(index===2?[232,244,236]:[246,249,247]) as Color);
  doc.roundedRect(cellX,metricTop,cell,metricsHeight,1.6,1.6,'F');
  font(doc,6,true,palette.muted);doc.text(item.label,cellX+4,metricTop+6);
  fit(doc,item.value,cell-8,17);doc.setTextColor(...(row.billingPending&&index>0?palette.pending:item.color));
  doc.text(item.value,cellX+4,metricTop+15);
  font(doc,6,false,palette.muted);doc.text(item.unit,cellX+4,metricTop+21);
 });

 const chartTop=metricTop+metricsHeight+4,chartHeight=available-header-metricsHeight-7;
 doc.setFillColor(248,251,249);doc.setDrawColor(...palette.border);
 doc.roundedRect(left,chartTop,inner,chartHeight,1.6,1.6,'FD');
 font(doc,7,true);doc.text('COMPARATIVO FINANCEIRO',left+4,chartTop+6);
 font(doc,5.8,false,palette.muted);doc.text('Bruto e líquido na mesma escala · R$',left+inner-4,chartTop+6,{align:'right'});
 const labelWidth=21,barX=left+labelWidth,barWidth=inner-labelWidth-6;
 const band=Math.max(6,(chartHeight-13)/2),barHeight=Math.min(7,band*.48);
 const maximum=Math.max(1,numeric(row.grossAmount)??0,numeric(row.netAmount)??0);
 for(const [index,key] of (['grossAmount','netAmount'] as const).entries()){
  const barY=chartTop+11+index*band,value=row.billingPending?null:numeric(row[key]);
  font(doc,7,true,key==='grossAmount'?palette.muted:palette.net);
  doc.text(key==='grossAmount'?'Bruto':'Líquido',left+4,barY+barHeight*.7);
  doc.setFillColor(...palette.border);doc.rect(barX,barY,barWidth,barHeight,'F');
  if(value!==null&&value>0){
   doc.setFillColor(...(key==='grossAmount'?palette.gross:palette.net));
   doc.rect(barX,barY,barWidth*Math.min(1,value/maximum),barHeight,'F');
  }
 }
 // Quantity has its own scale and is intentionally separate from currency.
 const quantity=numeric(row.volume);
 if(quantity!==null&&quantity>0){
  doc.setFillColor(...palette.volume);doc.rect(left+4,metricTop+metricsHeight-1.2,cell-8,.8,'F');
 }
}

// Values and totals arrive from the RPC. Arithmetic below measures geometry only.
export function drawContractFarmPdfChart(ctx:ContractPdfChartContext,rows:ContractFarmTotals[],period:string){
 const {doc,x,y,width,height}=ctx;
 doc.setLineWidth(.2);doc.setDrawColor(...palette.border);doc.setFillColor(255,255,255);
 doc.roundedRect(x,y,width,height,2.2,2.2,'FD');
 doc.setFillColor(...palette.gross);doc.roundedRect(x+5,y+5,1.2,10,.6,.6,'F');
 font(doc,6.5,true,palette.muted);doc.text('RESULTADO POR FAZENDA',x+9,y+7);
 font(doc,11,true);doc.text('Quantidade, faturamento bruto e líquido',x+9,y+13);
 font(doc,6.5,false,palette.muted);doc.text(`Período: ${period} · ${rows.length} ${rows.length===1?'fazenda':'fazendas'}`,x+5,y+19);
 if(!rows.length){font(doc,9,false,palette.muted);doc.text('Nenhuma fazenda com carregamento no período selecionado.',x+5,y+32);return;}
 if(rows.length===1){
  singleFarm(ctx,rows[0]);
  font(doc,5.8,false,palette.muted);
  doc.text('Valores do período selecionado · Quantidade em toneladas e faturamento em reais.',x+5,y+height-5);
  return;
 }

 const maxColumns=width>=230?3:2;
 const columns=Math.min(maxColumns,Math.max(1,Math.ceil(rows.length/9)));
 const gap=4,padding=5,columnWidth=(width-padding*2-gap*(columns-1))/columns;
 const perColumn=Math.ceil(rows.length/columns),top=y+25,available=height-35,rowHeight=available/perColumn;
 const every=Math.max(1,Math.ceil(4.8/rowHeight));
 const sparse=rowHeight>=25;
 const labelSize=sparse?Math.min(12,rowHeight*.35):Math.min(8,Math.max(4.4,rowHeight*.9));
 const maxVolume=Math.max(1,...rows.map(row=>numeric(row.volume)??0));
 const maxMoney=Math.max(1,...rows.flatMap(row=>row.billingPending?[]:[numeric(row.grossAmount)??0,numeric(row.netAmount)??0]));
 const metrics=[{key:'volume',label:'Quantidade (t)',color:palette.volume},{key:'gross',label:'Bruto (R$)',color:palette.gross},{key:'net',label:'Líquido (R$)',color:palette.net}] as const;

 rows.forEach((row,index)=>{
  const column=Math.floor(index/perColumn),position=index%perColumn;
  const left=x+padding+column*(columnWidth+gap),rowTop=top+position*rowHeight;
  const showLabel=every===1||position%every===0;
  const labelHeight=rowHeight,barHeight=sparse?Math.min(7,rowHeight*.12):Math.min(1.8,rowHeight*.12);
  const metricWidth=(columnWidth-4)/3;
  const background:Color=sparse||position%2?[247,250,248]:[255,255,255];
  doc.setFillColor(...background);
  doc.rect(left,rowTop,columnWidth,Math.max(.1,rowHeight-(sparse?2:0)),'F');
  if(showLabel){
   font(doc,labelSize,true);
   const nameWidth=columnWidth-3;
   if(rowHeight>=20){
    const wrapped=doc.splitTextToSize(row.name||'Fazenda não informada',nameWidth) as string[];
    doc.text(wrapped.slice(0,2).map((line,lineIndex)=>lineIndex===1&&wrapped.length>2?clipped(doc,line+'…',nameWidth):line),left+1,rowTop+(sparse?rowHeight*.18:3),{lineHeightFactor:1.1});
   }else doc.text(clipped(doc,row.name||'Fazenda não informada',nameWidth),left+1,rowTop+Math.min(3,rowHeight*.33));
  }
  metrics.forEach((metric,metricIndex)=>{
   const metricX=left+1+metricIndex*(metricWidth+1);
   const raw=metric.key==='volume'?row.volume:metric.key==='gross'?row.grossAmount:row.netAmount;
   const pending=metric.key!=='volume'&&row.billingPending,value=pending?null:numeric(raw);
   const scale=metric.key==='volume'?maxVolume:maxMoney;
   const barY=sparse?rowTop+rowHeight*.72:rowTop+rowHeight-barHeight-1;
   doc.setFillColor(...palette.border);doc.rect(metricX,barY,metricWidth-1,barHeight,'F');
   if(value!==null&&value>0){
    doc.setFillColor(...metric.color);doc.rect(metricX,barY,(metricWidth-1)*Math.min(1,value/scale),barHeight,'F');
   }
   if(showLabel){
    const text=pending?'Pendente':metric.key==='volume'?number(raw):money(raw);
    const valuesY=rowTop+(sparse?rowHeight*.56:every>1?Math.min(6,labelHeight*.7):labelHeight*.67);
    if(rowHeight>=15){font(doc,sparse?Math.min(9,rowHeight*.2):5.7,false,palette.muted);doc.text(metric.label,metricX,valuesY-(sparse?Math.max(4,rowHeight*.13):3));}
    fit(doc,text,metricWidth-1,sparse?Math.min(19,rowHeight*.3):Math.min(7.5,labelSize));
    doc.setTextColor(...(pending?palette.pending:metric.color));doc.text(text,metricX,valuesY);
   }
  });
 });

 font(doc,5.8,false,palette.muted);
 const footer=every>1?`Todas as ${rows.length} fazendas estão representadas; textos a cada ${every} linhas. Consulte os dados completos na tela.`:'Colunas: quantidade (t), bruto (R$) e líquido (R$). Escala de volume própria; bruto e líquido compartilham a escala monetária.';
 doc.text(doc.splitTextToSize(footer,width-10),x+5,y+height-5,{lineHeightFactor:1.1});
}
