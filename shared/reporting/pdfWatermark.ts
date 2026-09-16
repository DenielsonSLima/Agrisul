import type {jsPDF as JsPdf} from 'jspdf';
import {getReportOpacity,getReportWatermarkFrame} from './reportLayout';
import type {ReportPdfImage} from './pdfHeader';
import type {ReportWatermarkBrand} from './types';

export function drawReportPdfWatermark(doc:JsPdf,pageWidth:number,pageHeight:number,watermark:ReportWatermarkBrand,image:ReportPdfImage|null){
 if(!image)return;
 const frame=getReportWatermarkFrame(pageWidth,pageHeight,watermark.size);
 const width=Math.min(frame.width,frame.height*image.ratio),height=width/image.ratio;
 doc.saveGraphicsState();doc.setGState(doc.GState({opacity:getReportOpacity(watermark.opacity)}));
 doc.addImage(image.bytes,image.format,frame.x+(frame.width-width)/2,frame.y+(frame.height-height)/2,width,height,undefined,'FAST');
 doc.restoreGraphicsState();
}
