import {drawReportPdfHeader,drawReportPdfWatermark,REPORT_MARGIN_MM,type ReportPdfImage} from '@/shared/reporting';
import {formatCnpj} from '@/shared/utils/cnpj';
import type {BillingContract} from '../types';
import {contractSummaryDetails,summaryReceivedNote,type SummaryTable} from '../utils/contractSummaryDetails';
import {formatAtrCriterion,formatContractMonth} from '../utils/contractFormat';
import type {ContractMonthlyReportBrand} from './contractMonthlySummaryPdf';

type Color=[number,number,number];
type SummaryCard={label:string;value:string;hint:string;key?:string};
type SummaryIcon='gauge'|'scale'|'package'|'truck'|'money'|'calendar';
const palette={ink:[49,91,64],muted:[120,139,126],border:[220,232,224],surface:[249,252,250],green:[53,165,109],dark:[30,79,54],blue:[76,129,165]} satisfies Record<string,Color>;

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
export async function createContractSummaryDocument(contract:BillingContract,brand:ContractMonthlyReportBrand){
 const {jsPDF}=await import('jspdf');
 const doc=new jsPDF({orientation:brand.orientation,unit:'mm',format:'a4',compress:true});
 const summary=contractSummaryDetails(contract),margin=REPORT_MARGIN_MM;
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
 const metricLayout=(item:SummaryCard,cardWidth:number,kind?:SummaryIcon)=>{
  const textWidth=cardWidth-(kind?15.5:7),label=lines(item.label,6.4,textWidth),hint=lines(item.hint,5.7,textWidth);
  const size=fitValue(item.value,textWidth,10.6),value=lines(item.value,size,textWidth,true);
  return {label,hint,size,value,height:4+label.length*2.9+value.length*size*.41+hint.length*2.3+2.5};
 };
 const metric=(item:SummaryCard,x:number,top:number,cardWidth:number,cardHeight:number,kind?:SummaryIcon)=>{
  const dark=item.key==='pending',received=item.key==='received',textX=x+(kind?12:3.5);
  panel(x,top,cardWidth,cardHeight,dark?palette.dark:received?[237,248,241]:[255,255,255],dark?palette.dark:palette.border);
  if(kind)icon(kind,x+2.5,top+(cardHeight-7.5)/2);
  const {label,hint,size,value}=metricLayout(item,cardWidth,kind);
  font(6.4,false,dark?[255,255,255]:palette.muted);doc.text(label,textX,top+4,{lineHeightFactor:1.2});
  font(size,true,dark?[255,255,255]:received?[25,139,88]:palette.ink);doc.text(value,textX,top+4+label.length*2.9+size*.3,{lineHeightFactor:1.15});
  font(5.7,false,dark?[180,210,191]:palette.muted);doc.text(hint,textX,top+cardHeight-2.5-(hint.length-1)*2.3,{lineHeightFactor:1.15});
 };
 const hero=()=>{
  const gap=3,overviewWidth=content*.43,kpiWidth=(content-overviewWidth-gap*2)/2,copyX=margin+34,copyWidth=overviewWidth-38,valueWidth=(copyWidth-2)/2;
  const quantities=summary.operationalItems.slice(0,3).map((item,index)=>({...item,hint:index===1?`ATR médio: ${summary.operationalItems[3].value} kg/t`:item.hint}));
  const balances=summary.financialItems.filter(item=>item.key==='received'||item.key==='pending'||item.key==='credit');
  const copyValues=[quantities[1],quantities[0]].map(item=>{const size=fitValue(item.value,valueWidth,8.5);return {size,value:lines(item.value,size,valueWidth,true)};});
  const copyExtra=(Math.max(...copyValues.map(item=>item.value.length))-1)*3.5;
  const rowHeight=Math.max(...quantities.map(item=>metricLayout(item,kpiWidth,'scale').height),...balances.map(item=>metricLayout(item,kpiWidth).height));
  const heroHeight=Math.max(60+copyExtra,rowHeight*3+gap*2),kpiHeight=(heroHeight-gap*2)/3;
  ensure(heroHeight+6);panel(margin,y,overviewWidth,heroHeight,[242,249,245]);
  icon('gauge',margin+4,y+4);font(5.7,true,palette.muted);doc.text('VISÃO OPERACIONAL',margin+14,y+6.5);
  font(8.7,true);doc.text('Avanço do carregamento',margin+14,y+11);
  const statusWidth=Math.max(12,doc.getTextWidth(contract.status)*.65+4),statusX=margin+overviewWidth-statusWidth-4;
  doc.setFillColor(228,242,233);doc.roundedRect(statusX,y+16,statusWidth,5,1.3,1.3,'F');font(6,false,[47,133,84]);doc.text(contract.status,statusX+statusWidth/2,y+19.3,{align:'center'});
  const contracted=Number(summary.totals.contractedVolume),loaded=Number(summary.totals.loadedVolume);
  const percent=contracted>0?Math.max(0,Math.min(100,loaded/contracted*100)):0;
  const cx=margin+17,cy=y+39,radius=12;
  doc.setDrawColor(223,234,227);doc.setLineWidth(2.2);doc.circle(cx,cy,radius,'S');
  if(percent>0){
   doc.setDrawColor(...palette.green);doc.setLineWidth(2.2);doc.setLineCap('round');
   const segments=Math.max(2,Math.ceil(percent/100*100));let previous:[number,number]=[cx,cy-radius];
   for(let index=1;index<=segments;index++){const angle=-Math.PI/2+percent/100*Math.PI*2*index/segments,next:[number,number]=[cx+Math.cos(angle)*radius,cy+Math.sin(angle)*radius];doc.line(previous[0],previous[1],next[0],next[1]);previous=next;}
   doc.setLineCap('butt');
  }
  doc.setFillColor(252,254,252);doc.setDrawColor(...palette.border);doc.setLineWidth(.2);doc.circle(cx,cy,10,'FD');
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
   metric(item,x,top,kpiWidth,kpiHeight,(['scale','package','truck'] as const)[index]);
   metric(balances[index],x+kpiWidth+gap,top,kpiWidth,kpiHeight);
  });
  y+=heroHeight+6;
 };
 const financialOverview=()=>{
  const items=summary.financialItems.filter(item=>item.key!=='received'&&item.key!=='pending'&&item.key!=='credit'),gap=2.2,padding=4,cardWidth=(content-padding*2-gap*4)/5;
  const cards=items.map(item=>{const label=lines(item.label,7,cardWidth-5),hint=lines(item.hint,5.9,cardWidth-5),size=fitValue(item.value,cardWidth-5,10.2),value=lines(item.value,size,cardWidth-5,true);return {item,label,hint,size,value};});
  const cardHeight=Math.max(...cards.map(card=>8+card.label.length*3.1+card.value.length*card.size*.4+card.hint.length*2.6));
  const note=lines(summaryReceivedNote,6.5,content-padding*2),notice=summary.notice?lines(summary.notice,6.5,content-padding*2-6):[];
  const panelHeight=18+cardHeight+5+note.length*3+(notice.length?notice.length*3+8:0)+3;
  ensure(panelHeight+6);panel(margin,y,content,panelHeight);heading(margin+padding,y+4,'VISÃO FINANCEIRA · TODO O CONTRATO','Da entrega ao recebimento','money');
  cards.forEach((card,index)=>{
   const x=margin+padding+index*(cardWidth+gap),top=y+18;panel(x,top,cardWidth,cardHeight,palette.surface);
   font(7,false,palette.muted);doc.text(card.label,x+2.5,top+4.5,{lineHeightFactor:1.25});
   font(card.size,true);doc.text(card.value,x+2.5,top+6+card.label.length*3.1,{lineHeightFactor:1.2});
   font(5.9,false,palette.muted);doc.text(card.hint,x+2.5,top+cardHeight-3-(card.hint.length-1)*2.6,{lineHeightFactor:1.25});
  });
  const noteY=y+18+cardHeight+5;font(6.5,false,palette.muted);doc.text(note,margin+padding,noteY,{lineHeightFactor:1.3});
  if(notice.length){const noticeY=noteY+note.length*3+2;panel(margin+padding,noticeY,content-padding*2,notice.length*3+5,[251,248,239],[233,223,201]);font(6.5,false,[137,110,60]);doc.text(notice,margin+padding+3,noticeY+4,{lineHeightFactor:1.3});}
  y+=panelHeight+6;
 };
 const charts=()=>{
  if(!summary.months.length)return;
  const numberLabel=(value:number)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value);
  const axisLabel=(value:number,money:boolean)=>(money?'R$ ':'')+(value>=1000000?numberLabel(value/1000000)+' mi':value>=1000?numberLabel(value/1000)+' mil':numberLabel(value));
  // Every month remains visible; long calendars use additional chart panels.
  for(let offset=0;offset<summary.months.length;offset+=12){
   const rows=summary.months.slice(offset,offset+12),gap=3,padding=4,chartWidth=(content-padding*2-gap)/2,chartHeight=58,panelHeight=80;
   ensure(panelHeight);panel(margin,y,content,panelHeight);
   heading(margin+padding,y+4,'RESUMO MENSAL','Entregas, faturamento e entradas','calendar');
   const criterion='ATR '+formatAtrCriterion(contract.atrPriceType,contract.atrPeriodType);font(6.2,false,[47,133,84]);
   const criterionWidth=doc.getTextWidth(criterion)+5;
   doc.setFillColor(235,246,239);doc.roundedRect(width-margin-padding-criterionWidth,y+5,criterionWidth,5.5,1.3,1.3,'F');doc.text(criterion,width-margin-padding-2.5,y+8.6,{align:'right'});
   const top=y+17;
   const chart=(x:number,title:string,subtitle:string,money:boolean,series:{label:string;color:Color;values:(number|null)[]}[])=>{
    panel(x,top,chartWidth,chartHeight,palette.surface);font(7.3,true);doc.text(title,x+3,top+5);font(5.5,false,palette.muted);doc.text(subtitle,x+3,top+8.6);
    const left=x+(money?17:12),plotWidth=chartWidth-(money?21:16),base=top+chartHeight-14,plotHeight=30,slot=plotWidth/rows.length;
    const maximum=Math.max(1,...series.flatMap(item=>item.values.filter((value):value is number=>value!==null&&Number.isFinite(value))));
    const magnitude=10**Math.floor(Math.log10(maximum)),scale=Math.ceil(maximum/magnitude*2)/2*magnitude;
    for(let index=0;index<=4;index++){
     const gridY=base-plotHeight*index/4;doc.setDrawColor(227,237,231);doc.setLineWidth(.2);doc.setLineDashPattern([1,1.4],0);doc.line(left,gridY,left+plotWidth,gridY);doc.setLineDashPattern([],0);
     font(5.8,false,palette.muted);doc.text(axisLabel(scale*index/4,money),left-2,gridY+.8,{align:'right'});
    }
    rows.forEach((row,index)=>{
     const barWidth=Math.min(series.length===1?6:4.3,slot*.72/series.length),groupWidth=barWidth*series.length;
     series.forEach((item,seriesIndex)=>{
      const value=item.values[index];if(value===null||!Number.isFinite(value)||value<=0)return;
      const barHeight=value/scale*plotHeight,barX=left+(index+.5)*slot-groupWidth/2+seriesIndex*barWidth;
      doc.setFillColor(...item.color);doc.roundedRect(barX,base-barHeight,barWidth*.88,barHeight,Math.min(.8,barWidth*.2,barHeight/2),Math.min(.8,barWidth*.2,barHeight/2),'F');
     });
     font(5.8,false,palette.muted);doc.text(formatContractMonth(row.month).replace('/','\n'),left+(index+.5)*slot,base+3.3,{align:'center',lineHeightFactor:1.2});
    });
    if(series.length>1){
     font(5.8);const widths=series.map(item=>doc.getTextWidth(item.label)+5),legendWidth=widths.reduce((total,value)=>total+value,0)+3;
     let legendX=x+(chartWidth-legendWidth)/2;
     series.forEach((item,index)=>{doc.setFillColor(...item.color);doc.circle(legendX+1,top+chartHeight-3.5,.9,'F');font(5.8,false,item.color);doc.text(item.label,legendX+3,top+chartHeight-2.8);legendX+=widths[index]+3;});
    }
   };
   chart(margin+padding,'Quantidade carregada por mês','Toneladas entregues',false,[{label:'Quantidade entregue',color:[84,168,115],values:rows.map(row=>Number(row.finance?.loadedVolume??row.production?.loadedVolume??0))}]);
   chart(margin+padding+chartWidth+gap,'Faturado e recebido por mês','Entregas e entradas financeiras',true,[
    {label:'Faturado bruto',color:[47,128,82],values:rows.map(row=>row.finance?(row.finance.billingPending?null:Number(row.finance.grossAmount)):row.production?.billingPending?null:Number(row.production?.billingAmount??0))},
    {label:'Total recebido',color:palette.blue,values:rows.map(row=>row.finance?Number(row.finance.receivedAmount):null)},
   ]);
   if(summary.months.length>12){font(5.5,false,palette.muted);doc.text(`Período: ${formatContractMonth(rows[0].month)} a ${formatContractMonth(rows[rows.length-1].month)}`,margin+padding,y+panelHeight-1.7);}
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
 charts();
 for(const model of summary.tables)table(model);
 if(contract.notes.trim()){section('Observações do contrato');paragraph(contract.notes,8);}

 const pages=doc.getNumberOfPages();
 for(let page=1;page<=pages;page++){
  doc.setPage(page);const footerY=height-margin+2;doc.setDrawColor(225,232,227);doc.line(margin,footerY-5,width-margin,footerY-5);font(7,false,palette.muted);
  const issued=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(brand.issuedAt);
  const footer=doc.splitTextToSize(`Emitido por ${brand.issuer.name||brand.issuer.email} em ${issued}`,content-32)[0];doc.text(footer,margin,footerY);doc.text(`Página ${page} de ${pages}`,width-margin,footerY,{align:'right'});
 }
 return {doc,fileName:`resumo-contrato-${contract.id.slice(0,8)}-${brand.issuedAt.toISOString().slice(0,10)}.pdf`};
}
