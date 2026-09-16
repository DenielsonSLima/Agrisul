import {AlertCircle,CheckCircle2} from "lucide-react";
import {ModuleLink} from "@/shared/navigation/ModuleNavigation";
import {ReportDocument,type ReportCompanyBrand,type ReportHeaderVariant,type ReportIssuer,type ReportOrientation,type ReportWatermarkBrand} from "@/shared/reporting";

export function ReportHeaderPreview({orientation,header,company,watermark,issuer,issuedAt}:{orientation:ReportOrientation;header:ReportHeaderVariant;company:ReportCompanyBrand|null;watermark:ReportWatermarkBrand;issuer:ReportIssuer;issuedAt:Date}){
 const missingLogo=!company?.logoUrl;const missingWatermark=!watermark.imageUrl;
 return <section className="report-preview-panel" aria-label="Prévia do cabeçalho de relatório"><header className="report-preview-heading"><div><h3>Prévia do relatório</h3><span>A4 · {orientation==="portrait"?"Retrato":"Paisagem"}</span></div><div className="report-brand-status">{!missingLogo&&!missingWatermark?<span className="ready"><CheckCircle2/>Identidade completa</span>:<span><AlertCircle/>{[missingLogo&&"logo",missingWatermark&&"marca d’água"].filter(Boolean).join(" e ")} pendente{missingLogo&&missingWatermark?"s":""}</span>}</div></header>
  {(missingLogo||missingWatermark)&&<div className="report-brand-links">{missingLogo&&<ModuleLink href="/configuracoes?secao=empresas">Adicionar logo da empresa</ModuleLink>}{missingWatermark&&<ModuleLink href="/configuracoes?secao=marca-dagua">Configurar marca d’água</ModuleLink>}</div>}
  <div className="report-preview-stage"><ReportDocument orientation={orientation} header={header} company={company} watermark={watermark} issuer={issuer} issuedAt={issuedAt}/></div>
  <p className="report-preview-caption">O conteúdo dos relatórios futuros será inserido entre este cabeçalho e o rodapé padrão.</p>
 </section>;
}
