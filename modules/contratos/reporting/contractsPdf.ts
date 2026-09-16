import {drawReportPdfHeader,drawReportPdfWatermark,REPORT_MARGIN_MM,type ReportCompanyBrand,type ReportHeaderVariant,type ReportIssuer,type ReportOrientation,type ReportPdfImage,type ReportWatermarkBrand} from '@/shared/reporting';
import type {BillingContract,ContractBucket,ContractListData} from '../types';
import {formatContractDate} from '../utils/contractFormat';
import {contractsReportColors,contractsReportColumns,contractsReportNote,contractsReportOrientation,contractsReportRow,type ContractsReportCell} from './contractsReportPresentation';
import {contractSummaryItems,contractSummaryPendingNote} from '../utils/contractSummaryPresentation';

export type ContractsReportBrand={orientation:ReportOrientation;header:ReportHeaderVariant;company:ReportCompanyBrand|null;watermark:ReportWatermarkBrand;issuer:ReportIssuer;issuedAt:Date};
export type ContractsReportFilters={bucket:ContractBucket;search:string;from:string;to:string};
export type ContractsReportData=Pick<ContractListData,'contracts'|'summary'|'total'>;
async function imageRatio(blob:Blob){if(typeof createImageBitmap==='function'){const image=await createImageBitmap(blob);const ratio=image.width/image.height;image.close();return ratio;}const url=URL.createObjectURL(blob);try{return await new Promise<number>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth/image.naturalHeight);image.onerror=reject;image.src=url;});}finally{URL.revokeObjectURL(url);}}
async function loadImage(url:string|null):Promise<ReportPdfImage|null>{if(!url)return null;try{const response=await fetch(url);if(!response.ok)return null;const blob=await response.blob();return {bytes:new Uint8Array(await blob.arrayBuffer()),format:blob.type.includes('png')?'PNG':blob.type.includes('webp')?'WEBP':'JPEG',ratio:await imageRatio(blob)};}catch{return null;}}
const emitted=(date:Date)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(date);
const fileName=(date:Date,bucket:ContractBucket)=>`contratos-${bucket==='open'?'em-aberto':'finalizados'}-${date.toISOString().slice(0,10)}.pdf`;

export async function createContractsPdf({contracts,summary,total}:ContractsReportData,filters:ContractsReportFilters,brand:ContractsReportBrand){
 const {jsPDF}=await import('jspdf');const doc=new jsPDF({orientation:contractsReportOrientation,unit:'mm',format:'a4',compress:true});
 const pageWidth=doc.internal.pageSize.getWidth(),pageHeight=doc.internal.pageSize.getHeight(),margin=REPORT_MARGIN_MM,contentWidth=pageWidth-margin*2;
 const [logo,watermark]=await Promise.all([loadImage(brand.company?.logoUrl??null),loadImage(brand.watermark.imageUrl)]);
 if(brand.watermark.imageUrl&&!watermark)throw new Error('Não foi possível carregar a marca d’água configurada. Atualize a página e tente novamente.');
 const drawWatermark=()=>drawReportPdfWatermark(doc,pageWidth,pageHeight,brand.watermark,watermark);
 const drawHeader=()=>drawReportPdfHeader({doc,pageWidth,margin,orientation:contractsReportOrientation,settings:brand.header,company:brand.company,logo,title:filters.bucket==='open'?'Contratos em aberto':'Contratos finalizados'});
 const drawFilters=(y:number)=>{const period=filters.from||filters.to?`Data do contrato: ${filters.from?formatContractDate(filters.from):'início'} a ${filters.to?formatContractDate(filters.to):'sem limite'}`:'Todos os períodos';const search=filters.search?`Busca: ${filters.search}`:'Sem filtro de busca';doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(104,123,110);const lines=doc.splitTextToSize(`${total} contrato${total===1?'':'s'} · ${period} · ${search}`,contentWidth) as string[];doc.text(lines,margin,y+4);return y+lines.length*3.5+5;};
 const fitText=(value:string,width:number,size:number)=>{doc.setFontSize(size);while(doc.getTextWidth(value)>width&&size>6){size-=.25;doc.setFontSize(size);}return size;};
 const drawSummary=(y:number)=>{
  const columns=7,gap=2,width=(contentWidth-gap*(columns-1))/columns,height=21;
  contractSummaryItems(summary).forEach((item,index)=>{const x=margin+(index%columns)*(width+gap),top=y+Math.floor(index/columns)*(height+gap),colors=contractsReportColors[item.key];
   doc.setFillColor(colors.background);doc.setDrawColor('#cfdec4');doc.setLineWidth(.2);doc.roundedRect(x,top,width,height,1.5,1.5,'FD');
   doc.setFillColor(colors.accent);doc.rect(x+1.5,top,width-3,.6,'F');
   doc.setFont('helvetica','normal');doc.setTextColor('#365b2d');fitText(item.label,width-5,7);doc.text(item.label,x+2.5,top+5.5);
   doc.setFont('helvetica','bold');doc.setTextColor(colors.text);fitText(item.value,width-5,10);doc.text(item.value,x+2.5,top+12);
   doc.setFont('helvetica','normal');doc.setTextColor('#53614c');fitText(item.hint,width-5,6);doc.text(item.hint,x+2.5,top+17.5);
  });
  let bottom=y+Math.ceil(7/columns)*(height+gap)+3;
  if(summary.billingPending){doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor('#365b2d');const lines=doc.splitTextToSize(contractSummaryPendingNote,contentWidth) as string[];doc.text(lines,margin,bottom);bottom+=lines.length*3+3;}
  return bottom;
 };
 const widths=contractsReportColumns.map(column=>contentWidth*column.width/100);
 const headHeight=12,lineHeight=3.3,padding=2;
 const drawTableHeader=(y:number)=>{
  doc.setFillColor('#e2ecd9');doc.setDrawColor('#b9cda9');doc.setLineWidth(.2);
  doc.setFont('helvetica','bold');doc.setTextColor('#004f20');let x=margin;
  contractsReportColumns.forEach((column,index)=>{
   // PDF text changes the active fill color; restore the header fill for every cell.
   doc.setFillColor('#e2ecd9');
   doc.rect(x,y,widths[index],headHeight,'FD');
   fitText(column.label.split('\n')[0],widths[index]-4,7);
   doc.text(column.label.split('\n'),index===0?x+padding:x+widths[index]-padding,y+4.7,{lineHeightFactor:1.3,align:index===0?'left':'right'});x+=widths[index];
  });return y+headHeight;
 };
 const prepareCell=(cell:ContractsReportCell,index:number,financial:boolean)=>{
  const width=widths[index+1]-padding*2;
  doc.setFont('helvetica','bold');const font=fitText(cell.value,width,7.5);
  const lines=doc.splitTextToSize(cell.value,width) as string[];
  doc.setFont('helvetica','normal');doc.setFontSize(6.5);
  const labels=financial?doc.splitTextToSize(cell.label,width) as string[]:[];
  const detail=cell.detail?doc.splitTextToSize(cell.detail,width) as string[]:[];
  return {...cell,lines,font,labels,detail};
 };
 const prepareRow=(contract:BillingContract)=>{
  const row=contractsReportRow(contract);
  doc.setFont('helvetica','bold');doc.setFontSize(8.5);
  const clientLines=doc.splitTextToSize(row.client,widths[0]-6) as string[];
  doc.setFont('helvetica','normal');doc.setFontSize(7);
  const cnpjLines=doc.splitTextToSize(`CNPJ: ${row.cnpj}`,widths[0]-6) as string[];
  const operational=row.operational.map((cell,index)=>prepareCell(cell,index,false));
  const financial=row.financial.map((cell,index)=>prepareCell(cell,index,true));
  const topHeight=Math.max(12,...operational.map(cell=>(cell.lines.length+cell.detail.length)*lineHeight+5));
  const bottomHeight=Math.max(16,...financial.map(cell=>(cell.labels.length+cell.lines.length)*lineHeight+6));
  const clientHeight=(clientLines.length+cnpjLines.length)*lineHeight+10;
  const height=Math.max(topHeight+bottomHeight,clientHeight);
  return {clientLines,cnpjLines,operational,financial,topHeight:topHeight+(height-topHeight-bottomHeight),bottomHeight,height};
 };
 const drawRow=(y:number,row:ReturnType<typeof prepareRow>,index:number)=>{
  doc.setFillColor(index%2?'#f4f8ee':'#ffffff');doc.rect(margin,y,contentWidth,row.height,'F');
  doc.setDrawColor('#b9cda9');doc.setLineWidth(.2);doc.rect(margin,y,widths[0],row.height,'S');
  doc.setFillColor('#006b2d');doc.rect(margin,y,1,row.height,'F');
  let clientY=y+Math.max(5,(row.height-(row.clientLines.length+row.cnpjLines.length)*lineHeight-2)/2+2);
  doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor('#004f20');
  row.clientLines.forEach(line=>{doc.text(line,margin+3,clientY);clientY+=lineHeight;});
  clientY+=2;doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor('#53614c');
  row.cnpjLines.forEach(line=>{doc.text(line,margin+3,clientY);clientY+=lineHeight;});
  const drawCells=(cells:ReturnType<typeof prepareCell>[],top:number,height:number,financial:boolean)=>{
   let x=margin+widths[0];
   cells.forEach((cell,column)=>{
    const width=widths[column+1],colors=contractsReportColors[cell.tone];
    doc.setDrawColor('#b9cda9');doc.setLineWidth(.2);
    if(financial)doc.setFillColor(colors.background);
    doc.rect(x,top,width,height,financial?'FD':'S');
    doc.setTextColor(colors.text);let textY=top+4.7;
    if(financial){doc.setFont('helvetica','normal');doc.setFontSize(6.5);cell.labels.forEach(label=>{doc.text(label,x+padding,textY);textY+=lineHeight;});textY+=1;}
    doc.setFont('helvetica','bold');doc.setFontSize(cell.font);
    cell.lines.forEach(line=>{doc.text(line,x+width-padding,textY,{align:'right'});textY+=lineHeight;});
    doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor('#53614c');
    cell.detail.forEach(line=>{doc.text(line,x+width-padding,textY,{align:'right'});textY+=lineHeight;});
    x+=width;
   });
  };
  drawCells(row.operational,y,row.topHeight,false);
  drawCells(row.financial,y+row.topHeight,row.bottomHeight,true);
  doc.setDrawColor('#86a575');doc.setLineWidth(.65);doc.line(margin,y+row.height,pageWidth-margin,y+row.height);
 };
 const drawNote=(y:number)=>{
  doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor('#53614c');
  const lines=doc.splitTextToSize(contractsReportNote,contentWidth) as string[];doc.text(lines,margin,y+3.5);return y+lines.length*3+7;
 };
 const drawFooter=(page:number,pages:number)=>{const y=pageHeight-margin+2;doc.setDrawColor(225,232,227);doc.line(margin,y-5,pageWidth-margin,y-5);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(125,141,130);doc.text(`Emitido por ${brand.issuer.name||brand.issuer.email} em ${emitted(brand.issuedAt)}`,margin,y);doc.text(`Página ${page} de ${pages}`,pageWidth-margin,y,{align:'right'});};
 const startPage=()=>{drawWatermark();return drawTableHeader(drawNote(drawSummary(drawFilters(drawHeader()+2))));};
 let y=startPage();
 contracts.forEach((contract,index)=>{
  const row=prepareRow(contract);
  if(y+row.height>pageHeight-margin-8){doc.addPage();y=startPage();}
  drawRow(y,row,index);y+=row.height;
 });
 if(!contracts.length){doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(104,123,110);doc.text('Nenhum contrato encontrado para os filtros selecionados.',margin+2,y+7);}
 const pages=doc.getNumberOfPages();for(let page=1;page<=pages;page++){doc.setPage(page);drawFooter(page,pages);}
 return {doc,fileName:fileName(brand.issuedAt,filters.bucket)};
}
export async function downloadContractsPdf(data:ContractsReportData,filters:ContractsReportFilters,brand:ContractsReportBrand){const result=await createContractsPdf(data,filters,brand);result.doc.save(result.fileName);}
export async function printContractsPdf(data:ContractsReportData,filters:ContractsReportFilters,brand:ContractsReportBrand,popup:Window){const result=await createContractsPdf(data,filters,brand);result.doc.autoPrint();popup.location.href=String(result.doc.output('bloburl'));}
