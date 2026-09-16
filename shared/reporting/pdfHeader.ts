import type {jsPDF as JsPdf} from 'jspdf';
import {getReportCompanyDetails} from './companyBrand';
import {getReportHeaderMetrics} from './reportLayout';
import type {ReportCompanyBrand,ReportHeaderVariant,ReportOrientation} from './types';

export type ReportPdfImage={bytes:Uint8Array;format:string;ratio:number};

type DrawReportPdfHeaderOptions={
 doc:JsPdf;
 pageWidth:number;
 margin:number;
 orientation:ReportOrientation;
 settings:ReportHeaderVariant;
 company:ReportCompanyBrand|null;
 logo:ReportPdfImage|null;
 title:string;
};

const firstLine=(doc:JsPdf,value:string,width:number)=>doc.splitTextToSize(value,Math.max(width,1))[0]??'';

export function drawReportPdfHeader({doc,pageWidth,margin,orientation,settings,company,logo,title}:DrawReportPdfHeaderOptions){
 const contentWidth=pageWidth-margin*2,portrait=orientation==='portrait';
 const alignment=settings.logoAlignment,right=alignment==='right',center=alignment==='center';
 const titleWidth=portrait?0:Math.min(58,contentWidth*.27),sectionGap=portrait?0:7;
 const identitySlotWidth=contentWidth-titleWidth-sectionGap;
 const identitySlotX=portrait||!right?margin:margin+titleWidth+sectionGap;
 const identityWidth=center?Math.min(identitySlotWidth,portrait?142:150):identitySlotWidth;
 const identityX=identitySlotX+(center?(identitySlotWidth-identityWidth)/2:0);
 const titleX=portrait?margin:right?margin:margin+identitySlotWidth+sectionGap;
 const metrics=getReportHeaderMetrics(settings.variant),logoWidth=metrics.logoWidthMm,logoHeight=metrics.logoHeightMm,logoGap=3;
 const textWidth=identityWidth-logoWidth-logoGap,logoX=right?identityX+identityWidth-logoWidth:identityX;
 const copyX=right?identityX:identityX+logoWidth+logoGap,copyEdge=right?copyX+textWidth:copyX;
 const textAlign=right?'right':'left',details=getReportCompanyDetails(company,settings);
 const nameFont=metrics.namePt,cnpjFont=metrics.cnpjPt,detailFont=metrics.detailPt;
 const nameStep=metrics.nameStepMm,cnpjStep=metrics.cnpjStepMm,detailStep=metrics.detailStepMm;
 const labelGap=.55,columnGap=2.5,top=margin;
 let line=top+3;

 doc.setTextColor(52,71,59);doc.setFont('helvetica','bold');doc.setFontSize(nameFont);
 doc.text(firstLine(doc,company?.name||'Empresa não configurada',textWidth),copyEdge,line,{align:textAlign});
 line+=nameStep;
 if(details.cnpj){doc.setTextColor(109,125,115);doc.setFont('helvetica','normal');doc.setFontSize(cnpjFont);doc.text(firstLine(doc,details.cnpj,textWidth),copyEdge,line,{align:textAlign});line+=cnpjStep;}

 const drawCell=(label:string,value:string,x:number,width:number)=>{
  doc.setFontSize(detailFont);doc.setFont('helvetica','bold');
  const labelText=`${label}:`,labelWidth=doc.getTextWidth(labelText),valueWidth=Math.max(1,width-labelWidth-labelGap);
  doc.setFont('helvetica','normal');const visibleValue=firstLine(doc,value,valueWidth),visibleWidth=doc.getTextWidth(visibleValue);
  const start=right?x+width-labelWidth-labelGap-visibleWidth:x;
  doc.setFont('helvetica','bold');doc.text(labelText,start,line);
  doc.setFont('helvetica','normal');doc.text(visibleValue,start+labelWidth+labelGap,line);
 };
 const drawCells=(cells:{label:string;value:string;x:number;width:number}[])=>{
  if(!cells.length)return;
  doc.setTextColor(109,125,115);cells.forEach(cell=>drawCell(cell.label,cell.value,cell.x,cell.width));line+=detailStep;
 };
 if(details.address||details.district){
  const available=textWidth-columnGap*2,firstWidth=available*.52,middleWidth=available*.14,districtWidth=available-firstWidth-middleWidth;
  const addressWidth=details.district?firstWidth+middleWidth+columnGap:textWidth;
  drawCells([
   ...(details.address?[{label:'Endereço',value:details.address,x:copyX,width:addressWidth}]:[]),
   ...(details.district?[{label:'Bairro',value:details.district,x:copyX+firstWidth+middleWidth+columnGap*2,width:districtWidth}]:[]),
  ]);
 }
 if(details.city||details.state||details.zipCode){
  const available=textWidth-columnGap*2,cityWidth=available*.52,stateWidth=available*.14,zipWidth=available-cityWidth-stateWidth;
  drawCells([
   ...(details.city?[{label:'Cidade',value:details.city,x:copyX,width:cityWidth}]:[]),
   ...(details.state?[{label:'UF',value:details.state,x:copyX+cityWidth+columnGap,width:stateWidth}]:[]),
   ...(details.zipCode?[{label:'CEP',value:details.zipCode,x:copyX+cityWidth+stateWidth+columnGap*2,width:zipWidth}]:[]),
  ]);
 }
 if(details.contact){doc.setTextColor(109,125,115);doc.setFont('helvetica','normal');doc.setFontSize(detailFont);doc.text(firstLine(doc,`Contato: ${details.contact}`,textWidth),copyEdge,line,{align:textAlign});line+=detailStep;}

 const textHeight=Math.max(0,line-top-.3),identityHeight=Math.max(logoHeight,textHeight),logoY=top;
 if(logo){
  const width=Math.min(logoWidth,logoHeight*logo.ratio),height=width/logo.ratio;
  doc.addImage(logo.bytes,logo.format,logoX+(logoWidth-width)/2,logoY+(logoHeight-height)/2,width,height,undefined,'FAST');
 }else{
  doc.setFillColor(239,246,241);doc.roundedRect(logoX,logoY,logoWidth,logoHeight,1.5,1.5,'F');
  doc.setTextColor(70,126,88);doc.setFont('helvetica','bold');doc.setFontSize(5.5);doc.text('EMPRESA',logoX+logoWidth/2,logoY+logoHeight/2+1,{align:'center'});
 }

 let bottom=top+identityHeight;
 if(portrait){
  const titleY=bottom+3.5;doc.setDrawColor(237,241,238);doc.line(margin,titleY-4.5,pageWidth-margin,titleY-4.5);
  doc.setFont('helvetica','normal');doc.setFontSize(metrics.brandPt);doc.setTextColor(139,153,144);doc.text('CONTROLE DE FATURAMENTO',margin,titleY);
  doc.setFont('helvetica','bold');doc.setFontSize(metrics.titlePt);doc.setTextColor(54,70,60);doc.text(title,pageWidth-margin,titleY,{align:'right'});bottom=titleY+2.5;
 }else{
  const titleAlign=right?'left':'right',titleEdge=right?titleX:titleX+titleWidth;
  doc.setFont('helvetica','normal');doc.setFontSize(metrics.brandPt);doc.setTextColor(139,153,144);doc.text('CONTROLE DE FATURAMENTO',titleEdge,top+3,{align:titleAlign});
  doc.setFont('helvetica','bold');doc.setFontSize(metrics.titlePt);doc.setTextColor(54,70,60);
  const titleLines=doc.splitTextToSize(title,titleWidth) as string[];let titleY=top+8;
  for(const value of titleLines){doc.text(value,titleEdge,titleY,{align:titleAlign});titleY+=4;}
  bottom=Math.max(bottom,titleY);
 }
 bottom+=2;doc.setDrawColor(232,237,233);doc.line(margin,bottom,pageWidth-margin,bottom);return bottom;
}
