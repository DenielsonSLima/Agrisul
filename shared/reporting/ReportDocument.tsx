import type {CSSProperties,ReactNode} from "react";
import {ReportFooter} from "./ReportFooter";
import {ReportHeader} from "./ReportHeader";
import {ReportWatermark} from "./ReportWatermark";
import type {ReportCompanyBrand,ReportHeaderVariant,ReportIssuer,ReportOrientation,ReportWatermarkBrand} from "./types";
import {getReportHeaderMetrics,getReportPageSize,REPORT_MARGIN_MM} from './reportLayout';

export function ReportDocument({orientation,header,company,watermark,issuer,issuedAt,title="Relatório de exemplo",pageLabel,children}:{orientation:ReportOrientation;header:ReportHeaderVariant;company:ReportCompanyBrand|null;watermark:ReportWatermarkBrand;issuer:ReportIssuer;issuedAt:Date|string;title?:string;pageLabel?:string;children?:ReactNode}){
 const page=getReportPageSize(orientation),metrics=getReportHeaderMetrics(header.variant);
 const style={
  '--report-page-width':`${page.widthMm}mm`,'--report-page-height':`${page.heightMm}mm`,'--report-margin':`${REPORT_MARGIN_MM}mm`,
  '--report-logo-width':`${metrics.logoWidthMm}mm`,'--report-logo-height':`${metrics.logoHeightMm}mm`,'--report-name-size':`${metrics.namePt}pt`,'--report-cnpj-size':`${metrics.cnpjPt}pt`,
  '--report-detail-size':`${metrics.detailPt}pt`,'--report-title-size':`${metrics.titlePt}pt`,'--report-brand-size':`${metrics.brandPt}pt`,
 } as CSSProperties;
 return <article className={`report-document report-${orientation}`} style={style} aria-label={`Prévia A4 em ${orientation==="portrait"?"retrato":"paisagem"}`}>
  <ReportWatermark watermark={watermark}/>
  <div className="report-document-content"><ReportHeader company={company} settings={header} title={title}/>
   <div className="report-document-body">{children??<><div className="report-sample-summary"><span/><span/><span/></div><div className="report-sample-table">{Array.from({length:6},(_,index)=><span key={index}/>)}</div></>}</div>
   <ReportFooter issuer={issuer} issuedAt={issuedAt} pageLabel={pageLabel}/>
  </div>
 </article>;
}
