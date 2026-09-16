import {Building2} from "lucide-react";
import Image from "next/image";
import {getReportCompanyDetails} from './companyBrand';
import type {ReportCompanyBrand,ReportHeaderVariant} from "./types";

export function ReportHeader({company,settings,title}:{company:ReportCompanyBrand|null;settings:ReportHeaderVariant;title:string}){
 const details=getReportCompanyDetails(company,settings);
 return <header className={`report-document-header report-logo-${settings.logoAlignment} report-header-${settings.variant}`}>
  <div className="report-company-identity">
   <div className="report-company-logo">{company?.logoUrl?<Image src={company.logoUrl} alt="" width={96} height={96} unoptimized/>:<Building2 aria-hidden="true"/>}</div>
   <div className="report-company-copy"><strong>{company?.name||"Empresa não configurada"}</strong>
    {details.cnpj&&<span className="report-company-cnpj">{details.cnpj}</span>}
    {(details.address||details.district)&&<div className="report-company-detail-row report-company-address-row">
     {details.address&&<span className="report-company-address"><b>Endereço:</b>{details.address}</span>}
     {details.district&&<span className="report-company-district"><b>Bairro:</b>{details.district}</span>}
    </div>}
    {(details.city||details.state||details.zipCode)&&<div className="report-company-detail-row report-company-location-row">
     {details.city&&<span className="report-company-city"><b>Cidade:</b>{details.city}</span>}
     {details.state&&<span className="report-company-state"><b>UF:</b>{details.state}</span>}
     {details.zipCode&&<span className="report-company-zip"><b>CEP:</b>{details.zipCode}</span>}
    </div>}
    {details.contact&&<span className="report-company-contact">Contato: {details.contact}</span>}
   </div>
  </div>
  <div className="report-title"><span>CONTROLE DE FATURAMENTO</span><h3>{title}</h3></div>
 </header>;
}
