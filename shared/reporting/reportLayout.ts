import type {ReportHeaderVariantName,ReportOrientation} from './types';

export const REPORT_MARGIN_MM=14;

export const REPORT_HEADER_METRICS={
 detailed:{logoWidthMm:23,logoHeightMm:19,namePt:9.5,cnpjPt:7.5,detailPt:7.25,titlePt:11.5,brandPt:6,nameStepMm:4.1,cnpjStepMm:3.2,detailStepMm:3},
 compact:{logoWidthMm:20,logoHeightMm:16.5,namePt:9,cnpjPt:7,detailPt:6.75,titlePt:10.5,brandPt:5.75,nameStepMm:3.8,cnpjStepMm:3,detailStepMm:2.75},
} as const;

export function getReportPageSize(orientation:ReportOrientation){
 return orientation==='portrait'?{widthMm:210,heightMm:297}:{widthMm:297,heightMm:210};
}

export function getReportHeaderMetrics(variant:ReportHeaderVariantName){return REPORT_HEADER_METRICS[variant];}

export function getReportWatermarkFrame(pageWidth:number,pageHeight:number,size:number){
 const ratio=Math.min(100,Math.max(0,size))/100,width=pageWidth*ratio,height=pageHeight*ratio;
 return {x:(pageWidth-width)/2,y:(pageHeight-height)/2,width,height};
}

export function getReportOpacity(opacity:number){return Math.min(100,Math.max(0,opacity))/100;}
