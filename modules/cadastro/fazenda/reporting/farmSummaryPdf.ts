import type {jsPDF as JsPdf} from 'jspdf';
import {drawReportPdfHeader,drawReportPdfWatermark,REPORT_MARGIN_MM,type ReportCompanyBrand,type ReportHeaderVariant,type ReportIssuer,type ReportOrientation,type ReportPdfImage,type ReportWatermarkBrand} from '@/shared/reporting';
import type {FarmPortfolioSummary,FarmSummary} from '../types';
import {formatHectares} from '../utils/farmFormat';

export type FarmReportBrand={
 orientation:ReportOrientation;
 header:ReportHeaderVariant;
 company:ReportCompanyBrand|null;
 watermark:ReportWatermarkBrand;
 issuer:ReportIssuer;
 issuedAt:Date;
};

const imageFormat=(type:string)=>type.includes('png')?'PNG':type.includes('webp')?'WEBP':'JPEG';
async function imageRatio(blob:Blob){
 if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(blob);const ratio=bitmap.width/bitmap.height;bitmap.close();return ratio;}
 const url=URL.createObjectURL(blob);
 try{return await new Promise<number>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth/image.naturalHeight);image.onerror=()=>reject(new Error('Imagem inválida.'));image.src=url;});}
 finally{URL.revokeObjectURL(url);}
}
async function loadImage(url:string|null):Promise<ReportPdfImage|null>{
 if(!url)return null;
 try{
  const response=await fetch(url);if(!response.ok)return null;
  const blob=await response.blob();const ratio=await imageRatio(blob);
  return {bytes:new Uint8Array(await blob.arrayBuffer()),format:imageFormat(blob.type),ratio};
 }catch{return null;}
}
const short=(doc:JsPdf,value:string,width:number)=>doc.splitTextToSize(value,width)[0]??'';
const pct=(value:number)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value)+'%';
const emitted=(date:Date)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(date);
const safeFileName=(date:Date)=>`resumo-fazendas-${date.toISOString().slice(0,10)}.pdf`;

export async function createFarmSummaryPdf(farms:FarmSummary[],summary:FarmPortfolioSummary,brand:FarmReportBrand){
 const {jsPDF}=await import('jspdf');
 const doc=new jsPDF({orientation:brand.orientation,unit:'mm',format:'a4',compress:true});
 const pageWidth=doc.internal.pageSize.getWidth(),pageHeight=doc.internal.pageSize.getHeight();
 const margin=REPORT_MARGIN_MM,contentWidth=pageWidth-margin*2;
 const [logo,watermark]=await Promise.all([loadImage(brand.company?.logoUrl??null),loadImage(brand.watermark.imageUrl)]);
 if(brand.watermark.imageUrl&&!watermark)throw new Error('Não foi possível carregar a marca d’água configurada. Atualize a página e tente novamente.');
 const rowsPerPage=brand.orientation==='portrait'?18:10;
 const pages=Math.max(1,Math.ceil(farms.length/rowsPerPage));

 const drawWatermark=()=>drawReportPdfWatermark(doc,pageWidth,pageHeight,brand.watermark,watermark);
 const drawHeader=()=>drawReportPdfHeader({doc,pageWidth,margin,orientation:brand.orientation,settings:brand.header,company:brand.company,logo,title:'Resumo geral de fazendas'});
 const drawFooter=(page:number)=>{
  const y=pageHeight-margin+2;doc.setDrawColor(225,232,227);doc.line(margin,y-5,pageWidth-margin,y-5);
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(125,141,130);
  doc.text(`Emitido por ${brand.issuer.name||brand.issuer.email} em ${emitted(brand.issuedAt)}`,margin,y);
  doc.text(`Página ${page} de ${pages}`,pageWidth-margin,y,{align:'right'});
 };
 const drawSummary=(y:number)=>{
  const gap=3,boxWidth=(contentWidth-gap*4)/5;
  const items=[['Fazendas',String(summary.farmCount)],['Talhões',String(summary.plotCount)],['Área total',formatHectares(summary.totalHa)+' ha'],['Área usada',formatHectares(summary.usedHa)+' ha'],['Preservada',formatHectares(summary.preservedHa)+' ha']];
  items.forEach(([label,value],index)=>{const x=margin+index*(boxWidth+gap);doc.setFillColor(index===4?238:244,index===4?248:247,index===4?241:245);doc.roundedRect(x,y,boxWidth,15,1.5,1.5,'F');doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(126,145,132);doc.text(label,x+2,y+4);doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(index===4?42:67,index===4?121:91,index===4?78:75);doc.text(short(doc,value,boxWidth-4),x+2,y+10);});
  doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(105,127,112);doc.text(`${pct(summary.usedPercent)} da área total está distribuída em talhões.`,margin,y+20);return y+24;
 };
 const drawTable=(y:number,pageFarms:FarmSummary[])=>{
  const rowHeight=10,headHeight=10;
  const widths=[contentWidth*.27,contentWidth*.14,contentWidth*.11,contentWidth*.16,contentWidth*.16,contentWidth*.16];
  const labels=['Fazenda','Cidade / UF','Talhões','Área total','Área usada','Preservada'];
  doc.setFillColor(239,245,241);doc.rect(margin,y,contentWidth,headHeight,'F');doc.setFont('helvetica','bold');doc.setFontSize(8.25);doc.setTextColor(78,103,86);
  let x=margin;labels.forEach((label,index)=>{doc.text(label,x+2,y+6.3);x+=widths[index]});
  pageFarms.forEach((farm,index)=>{const rowY=y+headHeight+index*rowHeight;if(index%2) {doc.setFillColor(249,251,249);doc.rect(margin,rowY,contentWidth,rowHeight,'F');}doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(76,92,81);x=margin;const values=[farm.name,`${farm.city} / ${farm.state}`,String(farm.plotCount),formatHectares(farm.totalHa)+' ha',formatHectares(farm.usedHa)+' ha',formatHectares(farm.preservedHa)+' ha'];values.forEach((value,column)=>{doc.text(short(doc,value,widths[column]-4),x+2,rowY+6.3);x+=widths[column]});doc.setDrawColor(235,240,237);doc.line(margin,rowY+rowHeight,pageWidth-margin,rowY+rowHeight);});
 };

 for(let page=1;page<=pages;page++){
  if(page>1)doc.addPage();drawWatermark();const headerBottom=drawHeader();const tableY=page===1?drawSummary(headerBottom+6):headerBottom+7;drawTable(tableY,farms.slice((page-1)*rowsPerPage,page*rowsPerPage));drawFooter(page);
 }
 return {doc,fileName:safeFileName(brand.issuedAt)};
}

export async function downloadFarmSummaryPdf(farms:FarmSummary[],summary:FarmPortfolioSummary,brand:FarmReportBrand){
 const {doc,fileName}=await createFarmSummaryPdf(farms,summary,brand);doc.save(fileName);
}

export async function printFarmSummaryPdf(farms:FarmSummary[],summary:FarmPortfolioSummary,brand:FarmReportBrand,popup:Window){
 const {doc}=await createFarmSummaryPdf(farms,summary,brand);doc.autoPrint();const url=doc.output('bloburl');popup.location.href=String(url);
}
