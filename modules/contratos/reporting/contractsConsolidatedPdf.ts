import type {jsPDF} from 'jspdf';
import type {BillingContract,ContractListSummary} from '../types';

type Context={doc:jsPDF;x:number;y:number;width:number;height:number};
type Data={contracts:BillingContract[];summary:ContractListSummary;total:number};
const colors={ink:'#193d2c',muted:'#60756b',line:'#dce8e0',pale:'#f3f8f5',gross:'#51a875',net:'#1b704c',amber:'#bd7c29',red:'#b52435'};
const decimal=(value:unknown)=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
const currency=(value:number|null)=>value===null?'n/d':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
const number=(value:number|null,digits=2)=>value===null?'n/d':new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:digits}).format(value);

/** All metrics are the RPC consolidated snapshot; only chart geometry is calculated here. */
export function drawContractsConsolidatedPdf({doc,x,y,width,height}:Context,{summary,total}:Data){
 const text=(value:string,tx:number,ty:number,size=8,color=colors.ink,bold=false,available=width)=>{
  doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);
  while(doc.getTextWidth(value)>available&&size>6){size-=.25;doc.setFontSize(size);}
  doc.setTextColor(color);doc.text(value,tx,ty);
 };
 const box=(bx:number,by:number,bw:number,bh:number,fill=colors.pale)=>{
  doc.setFillColor(fill);doc.setDrawColor(colors.line);doc.setLineWidth(.2);doc.roundedRect(bx,by,bw,bh,2,2,'FD');
 };
 const known=(value:unknown,dependsOnAtr=false)=>dependsOnAtr&&summary.billingPending?null:decimal(value);
 const net=known(summary.netAmount,true),pending=known(summary.pendingAmount,true);
 const financial=[
  {label:'Faturado bruto',value:known(summary.grossAmount,true),color:colors.gross},
  {label:'Despesas / descontos',value:known(summary.discountAmount),color:colors.amber},
  {label:'Valor líquido',value:net,color:colors.net},
 ];
 const unavailable=(value:number|null,dependent=false)=>value===null&&dependent&&summary.billingPending?'Aguardando ATR':currency(value);
 doc.setFillColor(colors.net);doc.rect(x,y+1,1.1,10,'F');
 text('CONSOLIDADO DA CARTEIRA',x+4,y+4,7,colors.muted,true);
 text('Da entrega ao recebimento',x+4,y+10,14,colors.ink,true);
 text(`${total} contrato${total===1?'':'s'} selecionado${total===1?'':'s'} · Indicadores oficiais do conjunto filtrado`,x+4,y+15,7,colors.muted);
 const gap=3,cardWidth=(width-gap*3)/4,cardY=y+20,cardHeight=23;
 const metrics=[
  {label:'Volume carregado',value:decimal(summary.loadedVolume)===null?'n/d':`${number(decimal(summary.loadedVolume))} t`,hint:'Entregas de todos os contratos',color:colors.ink},
  {label:'ATR médio ponderado',value:decimal(summary.averageAtr)===null?'n/d':`${number(decimal(summary.averageAtr),4)} kg/t`,hint:'Ponderado pelo volume entregue',color:colors.amber},
  {label:'Líquido consolidado',value:unavailable(net,true),hint:'Faturamento após descontos',color:colors.net},
  {label:'Saldo a receber',value:unavailable(pending,true),hint:'Saldo após os recebimentos',color:colors.red},
 ];
 metrics.forEach((metric,index)=>{
  const left=x+index*(cardWidth+gap),fill=index===3?'#fff2f2':index===2?'#e8f3ec':colors.pale;
  box(left,cardY,cardWidth,cardHeight,fill);
  text(metric.label,left+3,cardY+5.5,8,metric.color,true,cardWidth-6);
  text(metric.value,left+3,cardY+13,13,metric.color,true,cardWidth-6);
  text(metric.hint,left+3,cardY+19,6.5,colors.muted,false,cardWidth-6);
 });
 const panelY=y+48,panelHeight=Math.max(49,height-60),leftWidth=width*.61,rightX=x+leftWidth+gap,rightWidth=width-leftWidth-gap;
 box(x,panelY,leftWidth,panelHeight,'#ffffff');
 text('Composição do faturamento',x+4,panelY+6.5,10,colors.ink,true);
 text('Comparação dos totais · R$',x+4,panelY+11,6.5,colors.muted);
 const plotX=x+8,plotWidth=leftWidth-16,top=panelY+20,bottom=panelY+panelHeight-17;
 const max=Math.max(0,...financial.map(item=>item.value??0)),min=Math.min(0,...financial.map(item=>item.value??0));
 const span=max-min||1,plotHeight=Math.max(12,bottom-top),toY=(value:number)=>bottom-(value-min)/span*plotHeight,zeroY=toY(0);
 doc.setDrawColor(colors.line);doc.setLineWidth(.2);
 for(let tick=0;tick<=3;tick++){const ty=top+plotHeight*tick/3;doc.line(plotX,ty,plotX+plotWidth,ty);}
 doc.setDrawColor('#8da396');doc.line(plotX,zeroY,plotX+plotWidth,zeroY);
 financial.forEach((item,index)=>{
  const step=plotWidth/3,cx=plotX+step*(index+.5),barWidth=Math.min(14,step*.33);
  if(item.value!==null&&item.value!==0){const valueY=toY(item.value);doc.setFillColor(item.color);doc.rect(cx-barWidth/2,Math.min(valueY,zeroY),barWidth,Math.abs(valueY-zeroY),'F');}
  const value=unavailable(item.value,index!==1);
  doc.setFont('helvetica','bold');doc.setFontSize(8);
  text(value,cx-doc.getTextWidth(value)/2,panelY+panelHeight-10,8,item.color,true,step-3);
  doc.setFont('helvetica','normal');doc.setFontSize(6.5);
  text(item.label,cx-doc.getTextWidth(item.label)/2,panelY+panelHeight-5,6.5,colors.muted,false,step-3);
 });
 box(rightX,panelY,rightWidth,panelHeight,'#ffffff');
 text('Recebimentos e saldo',rightX+4,panelY+6.5,10,colors.ink,true);
 text('Entradas e posições financeiras · R$',rightX+4,panelY+11,6.5,colors.muted);
 const cash=[
  {label:'Recebidos',value:known(summary.receivedAmount),color:colors.net},
  {label:'A receber',value:pending,color:colors.red},
  {label:'Excedente recebido',value:known(summary.creditAmount,true),color:'#517f91'},
 ];
 const cashMax=Math.max(1,...cash.map(item=>Math.abs(item.value??0))),rowHeight=(panelHeight-19)/3;
 cash.forEach((item,index)=>{
  const cy=panelY+19+index*rowHeight,inner=rightWidth-8;
  text(item.label,rightX+4,cy,7,colors.muted);
  text(unavailable(item.value,index>0),rightX+4,cy+5.5,11,item.color,true,inner);
  doc.setFillColor(colors.pale);doc.rect(rightX+4,cy+8,inner,1.4,'F');
  if(item.value!==null){doc.setFillColor(item.color);doc.rect(rightX+4,cy+8,Math.abs(item.value)/cashMax*inner,1.4,'F');}
 });
 text('Recebidos já incluem adiantamentos e descontam estornos. Não somar os adiantamentos novamente.',x,y+height-6,6.5,colors.muted);
 text('Despesas / descontos representam os acordos aplicados, não o custo total de produção. n/d = dado indisponível.',x,y+height-2,6.5,colors.muted);
}
