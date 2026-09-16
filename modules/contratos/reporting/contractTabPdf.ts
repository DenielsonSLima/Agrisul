import type {jsPDF as JsPdf} from 'jspdf';
import {drawReportPdfHeader,drawReportPdfWatermark,REPORT_MARGIN_MM,type ReportPdfImage} from '@/shared/reporting';
import {formatCnpj} from '@/shared/utils/cnpj';
import type {ContractsReportBrand} from './contractsPdf';
import type {BillingContract,ContractLoadsData} from '../types';
import {formatAtr,formatAtrCriterion,formatAtrQuote,formatContractBilling,formatContractLoadAmount,formatContractDate,formatContractMonth,formatContractVolume} from '../utils/contractFormat';
import {formatDiscountRate,formatMonthlyDiscount} from '../utils/contractDiscountPresentation';

export type ContractTabReportGroup={title:string;subtitle:string;notes?:string;notesAfterTable?:boolean;columns?:string[];widths?:number[];tone?:'plain'|'muted';columnTones?:('green'|'sand'|null)[];discountMatrix?:boolean;hasTotalRow?:boolean;rows:string[][]};
export type ContractTabReport={kind:'loads'|'financial';title:string;criteria:string;metrics:{label:string;value:string;tone?:'discount'|'net'}[];columns:string[];widths:number[];groups:ContractTabReportGroup[]};
export const contractTabReportOrientation='landscape' as const;
export function loadsReportModel(data:ContractLoadsData):ContractTabReport{
 const {filters,summary}=data;
 const period=filters.from||filters.to?`${filters.from?formatContractDate(filters.from):'Sem limite inicial'} a ${filters.to?formatContractDate(filters.to):'sem limite final'}`:'Todo o período';
 return {kind:'loads',title:'Carregamentos do contrato',criteria:`${period} · ${filters.search?`Busca: ${filters.search}`:'Sem filtro de busca'} · ${filters.groupBy==='month'?'Por mês':filters.groupBy==='farm'?'Por fazenda':'Sem agrupamento'}`,
  metrics:[{label:'Quantidade carregada',value:formatContractVolume(summary.volume)},{label:'Carregamentos',value:String(summary.loadCount)},{label:'Fazendas de origem',value:String(summary.farmCount)},{label:'ATR médio ponderado',value:formatAtr(summary.averageAtr)},
   {label:'Faturamento',value:formatContractLoadAmount(summary.grossAmount,summary.billingPending)},
   {label:'Descontos',value:formatContractLoadAmount(summary.discountAmount),tone:'discount'},
   {label:'Valor líquido',value:formatContractLoadAmount(summary.netAmount,summary.billingPending),tone:'net'}],
  columns:['Data','Fazenda / talhão','Documento / observações','Quantidade (t)','ATR (kg/t)','Faturamento','Desconto','Valor líquido'],widths:[.09,.16,.18,.10,.07,.14,.12,.14],
  groups:data.groups.map(group=>({title:filters.groupBy==='month'?formatContractMonth(group.label):group.label,subtitle:`${group.loadCount} carregamentos · ${formatContractVolume(group.volume)} · ATR médio ${formatAtr(group.averageAtr)}`,rows:group.loads.map(load=>[formatContractDate(load.loadedAt),`${load.farmName}\n${load.plotName}`,[load.document,load.notes].filter(Boolean).join('\n')||'—',formatContractVolume(load.volume),formatAtr(load.atr),formatContractLoadAmount(load.grossAmount,load.billingPending),formatContractLoadAmount(load.discountAmount),formatContractLoadAmount(load.netAmount,load.billingPending)])}))};
}
export function financialReportModel(contract:BillingContract):ContractTabReport{
 if(contract.financialSummary){const summary=contract.financialSummary;
  return {kind:'financial',title:'Financeiro do contrato',criteria:`Todo o período · ATR ${formatAtrCriterion(contract.atrPriceType,contract.atrPeriodType)}`,
   metrics:[{label:'Valor líquido',value:formatContractBilling(summary.totals.netAmount,summary.totals.billingPending)},{label:'Descontos',value:formatContractBilling(summary.totals.discountAmount)},{label:'Total recebido',value:formatContractBilling(summary.totals.receivedAmount)},{label:'Saldo pendente',value:formatContractBilling(summary.totals.pendingAmount,summary.totals.billingPending)}],
   columns:['Mês','Quantidade','Bruto','Descontos','Líquido','Recebido','Pendente'],widths:[.10,.14,.15,.15,.15,.15,.16],
   groups:[{title:'Movimento financeiro mensal',subtitle:'Valores do contrato, incluindo adiantamentos, recebimentos e descontos.',rows:summary.months.map(month=>[formatContractMonth(month.month),formatContractVolume(month.loadedVolume),formatContractBilling(month.grossAmount,month.billingPending),formatContractBilling(month.discountAmount),formatContractBilling(month.netAmount,month.billingPending),formatContractBilling(month.receivedAmount),formatContractBilling(month.pendingAmount,month.billingPending)])},
    ...(summary.discounts.length?[{
     title:'Descontos por tonelada — resumo mensal',
     subtitle:'Cada coluna identifica um tipo de desconto. — indica que o desconto não se aplica ao mês.',
     notes:summary.discounts.map(discount=>`${discount.title} (${formatDiscountRate(discount.ratePerTon)})\nObservação: ${discount.notes||'Não informada.'}`).join('\n\n'),notesAfterTable:true,
     columns:['Mês','Toneladas carregadas',...summary.discounts.map(discount=>`${discount.title}\n${formatDiscountRate(discount.ratePerTon)}`),'Total de descontos'],
     widths:[.12,.16,...summary.discounts.map(()=>.54/summary.discounts.length),.18],
     columnTones:[null,null,...summary.discounts.map((_,index)=>index%2===0?'green' as const:'sand' as const),null],discountMatrix:true,hasTotalRow:true,
     rows:[...summary.months.map(month=>[formatContractMonth(month.month),formatContractVolume(month.loadedVolume),...summary.discounts.map(discount=>formatMonthlyDiscount(discount,month.month)),formatContractBilling(month.discountAmount)]),
      ['Geral do contrato',formatContractVolume(summary.totals.loadedVolume),...summary.discounts.map(discount=>formatContractBilling(discount.amount)),formatContractBilling(summary.totals.discountAmount)]],
    } satisfies ContractTabReportGroup]:[])]};
 }
 return {kind:'financial',title:'Financeiro do contrato',criteria:`Todo o período · ATR ${formatAtrCriterion(contract.atrPriceType,contract.atrPeriodType)}`,
  metrics:[{label:'Faturamento calculado',value:formatContractBilling(contract.billingAmount,contract.billingPending)},{label:'Despesas',value:'A ajustar'},{label:'Situação',value:contract.status}],
  columns:['Mês','Quantidade','ATR médio','Cotação ATR','Faturamento'],widths:[.14,.22,.18,.20,.26],
  groups:[{title:'Faturamento mensal',subtitle:contract.billingPending?'Há meses com ATR medido ou cotação pendente.':'Valores conforme os carregamentos e a cotação do mês anterior.',rows:(contract.monthlySummary?.months??[]).map(month=>[formatContractMonth(month.month),formatContractVolume(month.loadedVolume),formatAtr(month.averageLoadAtr),formatAtrQuote(month.atrQuote),formatContractBilling(month.billingAmount,month.billingPending)])}]};
}
async function loadImage(url:string|null):Promise<ReportPdfImage|null>{
 if(!url)return null;
 const response=await fetch(url);if(!response.ok)throw new Error('Não foi possível carregar a identidade visual do relatório. Tente novamente.');
 const blob=await response.blob();let ratio:number;
 if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(blob);ratio=bitmap.width/bitmap.height;bitmap.close();}
 else{const objectUrl=URL.createObjectURL(blob);try{ratio=await new Promise<number>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth/img.naturalHeight);img.onerror=reject;img.src=objectUrl;});}finally{URL.revokeObjectURL(objectUrl);}}
 return {bytes:new Uint8Array(await blob.arrayBuffer()),format:blob.type.includes('png')?'PNG':blob.type.includes('webp')?'WEBP':'JPEG',ratio};
}

// Arithmetic below measures page geometry only. All quantities come from RPCs.
export async function createContractTabPdf(contract:BillingContract,model:ContractTabReport,brand:ContractsReportBrand){
 const {jsPDF}=await import('jspdf');const doc=new jsPDF({orientation:contractTabReportOrientation,unit:'mm',format:'a4',compress:true});
 const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight(),margin=REPORT_MARGIN_MM,content=width-margin*2,bottom=height-margin-10;
 const [logo,watermark]=await Promise.all([loadImage(brand.company?.logoUrl??null),loadImage(brand.watermark.imageUrl)]);
 let y=0;
 const text=(value:string,size=8,bold=false)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(65,88,73);const lines=doc.splitTextToSize(value,content);doc.text(lines,margin,y);y+=lines.length*size*.43+2;};
 const startPage=()=>{
  drawReportPdfWatermark(doc,width,height,brand.watermark,watermark);
  y=drawReportPdfHeader({doc,pageWidth:width,margin,orientation:contractTabReportOrientation,settings:brand.header,company:brand.company,logo,title:model.title})+6;
  text(contract.clientName,10,true);
  if(contract.clientCnpj)text('CNPJ: '+formatCnpj(contract.clientCnpj));
  if(contract.contractNumber)text('Nº do contrato: '+contract.contractNumber);
  text(model.criteria,8);y+=2;
 };
 const addPage=()=>{doc.addPage();startPage();};
 startPage();
 if(model.kind==='loads'){
  const gap=2,cardWidth=(content-gap*(model.metrics.length-1))/model.metrics.length,textWidth=cardWidth-5;
  const cards=model.metrics.map(metric=>{
   doc.setFont('helvetica','normal');doc.setFontSize(6.5);
   const label:string[]=doc.splitTextToSize(metric.label,textWidth);
   doc.setFont('helvetica','bold');doc.setFontSize(9.5);
   const size=Math.max(7,Math.min(9.5,9.5*textWidth/Math.max(doc.getTextWidth(metric.value),1)));
   doc.setFontSize(size);const value:string[]=doc.splitTextToSize(metric.value,textWidth);
   return {...metric,label,value,size};
  });
  const cardHeight=Math.max(14,...cards.map(card=>6+card.label.length*2.7+card.value.length*card.size*.4));
  cards.forEach((card,i)=>{
   const x=margin+i*(cardWidth+gap),net=card.tone==='net',discount=card.tone==='discount';
   if(net){doc.setFillColor(237,248,241);doc.setDrawColor(207,231,216);}else{doc.setFillColor(250,252,251);doc.setDrawColor(224,234,227);}
   doc.setLineWidth(.2);doc.roundedRect(x,y,cardWidth,cardHeight,1.5,1.5,'FD');
   doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(112,132,119);
   doc.text(card.label,x+2.5,y+4,{lineHeightFactor:1.18});
   doc.setFont('helvetica','bold');doc.setFontSize(card.size);
   if(net)doc.setTextColor(25,139,88);else if(discount)doc.setTextColor(148,104,50);else doc.setTextColor(49,91,64);
   doc.text(card.value,x+2.5,y+4+card.label.length*2.7+card.size*.35,{lineHeightFactor:1.13});
  });
  y+=cardHeight+6;
 }else{
  const metricWidth=content/model.metrics.length;
  model.metrics.forEach((metric,i)=>{const x=margin+i*metricWidth;doc.setFillColor(240,246,242);doc.roundedRect(x,y,metricWidth-2,17,1,1,'F');doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text(metric.label,x+3,y+5);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text(metric.value,x+3,y+12);});y+=24;
 }
 if(!model.groups.length)text('Nenhum carregamento encontrado para os filtros selecionados.');
 // Wide matrices continue across sheets, repeating month, volume and the overall total.
 const groups=model.groups.flatMap(group=>{
  if(!group.discountMatrix||!group.columns)return [group];
  const count=group.columns.length-3,perSheet=Math.max(1,Math.floor((content-77)/32));
  return Array.from({length:Math.ceil(count/perSheet)},(_,sheet)=>{
   const first=sheet*perSheet,size=Math.min(perSheet,count-first),indexes=[0,1,...Array.from({length:size},(_,i)=>first+i+2),group.columns!.length-1];
   return {...group,
    subtitle:count>perSheet?`${group.subtitle} Colunas de descontos ${first+1} a ${first+size} de ${count}; o total inclui todos os descontos.`:group.subtitle,
    columns:indexes.map(i=>group.columns![i]),widths:[22/content,27/content,...Array.from({length:size},()=>(content-77)/size/content),28/content],
    columnTones:indexes.map(i=>group.columnTones?.[i]??null),rows:group.rows.map(row=>indexes.map(i=>row[i])),notes:first+size===count?group.notes:undefined,
   };
  });
 });
 for(const group of groups){
  const columns=group.columns??model.columns,widths=(group.widths??model.widths).map(part=>part*content);
  const groupHeading=(continued=false)=>{text(group.title+(continued?' (continuação)':''),9,true);text(group.subtitle,7);};
  doc.setFont('helvetica','bold');doc.setFontSize(7);
  const labels:string[][]=columns.map((label,i)=>doc.splitTextToSize(label,widths[i]-4));
  const headerHeight=Math.max(...labels.map(lines=>lines.length))*3.4+4;
  const fillColumns=(rowHeight:number)=>{
   let x=margin;
   widths.forEach((columnWidth,i)=>{const tone=group.columnTones?.[i];if(tone){if(tone==='green')doc.setFillColor(241,247,243);else doc.setFillColor(252,248,239);doc.rect(x,y,columnWidth,rowHeight,'F');}x+=columnWidth;});
  };
  const tableHeader=()=>{
   doc.setFont('helvetica','bold');doc.setFontSize(7);
   doc.setFillColor(235,243,238);doc.rect(margin,y,content,headerHeight,'F');fillColumns(headerHeight);let x=margin;
   labels.forEach((lines,i)=>{doc.text(lines,x+2,y+4,{lineHeightFactor:1.36});x+=widths[i];});y+=headerHeight;
  };
  const continueTable=()=>{addPage();groupHeading(true);tableHeader();};
  doc.setFont('helvetica','bold');doc.setFontSize(9);
  const titleHeight=doc.splitTextToSize(group.title,content).length*4;
  doc.setFont('helvetica','normal');doc.setFontSize(7);
  const subtitleHeight=doc.splitTextToSize(group.subtitle,content).length*3.1;
  if(y+titleHeight+subtitleHeight+headerHeight+13>bottom)addPage();
  groupHeading();
  const renderNotes=()=>{if(group.notes){
   doc.setFont('helvetica','normal');doc.setFontSize(7.5);
   const lines:string[]=doc.splitTextToSize(group.notes,content-4);let offset=0;
   while(offset<lines.length){
    if(y+8>bottom){addPage();groupHeading(true);}
    const count=Math.min(Math.max(1,Math.floor((bottom-y-4)/3.6)),lines.length-offset),noteHeight=count*3.6+4;
    if(group.tone==='muted'){doc.setFillColor(248,250,248);doc.rect(margin,y,content,noteHeight,'F');}
    doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(70,89,77);
    doc.text(lines.slice(offset,offset+count),margin+2,y+4,{lineHeightFactor:1.36});y+=noteHeight;offset+=count;
   }
   y+=2;
  }};
  if(!group.notesAfterTable)renderNotes();
  if(y+headerHeight+9>bottom){addPage();groupHeading(true);}
  tableHeader();
  if(!group.rows.length){y+=6;text('Nenhum lançamento no período.');}
  for(const [rowIndex,row] of group.rows.entries()){
   doc.setFont('helvetica','normal');doc.setFontSize(7.5);
   const cells:string[][]=row.map((value,i)=>doc.splitTextToSize(value,widths[i]-4));
   let offset=0;const lineCount=Math.max(...cells.map(cell=>cell.length));
   while(offset<lineCount){
    if(y+9>bottom)continueTable();
    const fitting=Math.max(1,Math.floor((bottom-y-4)/3.6));
    const count=Math.min(fitting,lineCount-offset),rowHeight=count*3.6+4;
    if(group.tone==='muted'){doc.setFillColor(248,250,248);doc.rect(margin,y,content,rowHeight,'F');}
    const totalRow=group.hasTotalRow&&rowIndex===group.rows.length-1;
    if(totalRow){doc.setFillColor(235,243,238);doc.rect(margin,y,content,rowHeight,'F');}
    fillColumns(rowHeight);
    doc.setFont('helvetica',totalRow?'bold':'normal');doc.setFontSize(7.5);doc.setTextColor(70,89,77);let x=margin;
    cells.forEach((lines,i)=>{const part=lines.slice(offset,offset+count);if(part.length)doc.text(part,x+2,y+4,{lineHeightFactor:1.36});x+=widths[i];});
    doc.setDrawColor(229,236,232);doc.line(margin,y+rowHeight,width-margin,y+rowHeight);y+=rowHeight;offset+=count;
    if(offset<lineCount)continueTable();
   }
  }
  if(group.notesAfterTable){y+=4;renderNotes();}
  y+=8;
 }
 const pages=doc.getNumberOfPages();
 for(let page=1;page<=pages;page++){doc.setPage(page);drawFooter(doc,page,pages,width,height,margin,brand);}
 return {doc,fileName:`${model.kind==='loads'?'carregamentos':'financeiro'}-contrato-${contract.id.slice(0,8)}-${brand.issuedAt.toISOString().slice(0,10)}.pdf`};
}
function drawFooter(doc:JsPdf,page:number,pages:number,width:number,height:number,margin:number,brand:ContractsReportBrand){
 const y=height-margin+2;doc.setDrawColor(225,232,227);doc.line(margin,y-5,width-margin,y-5);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(115,133,122);
 const issued=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(brand.issuedAt);
 const label=doc.splitTextToSize(`Emitido por ${brand.issuer.name||brand.issuer.email} em ${issued}`,width-margin*2-30)[0];
 doc.text(label,margin,y);doc.text(`Página ${page} de ${pages}`,width-margin,y,{align:'right'});
}
