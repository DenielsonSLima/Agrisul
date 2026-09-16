import {Building2,Building,ArrowUpRight,MapPin} from "lucide-react";
import Image from "next/image";
import {ModuleLink} from "@/shared/navigation/ModuleNavigation";
import type {Company} from "../types";
import {formatCnpj} from "../utils/companyValidation";
import {companyHref} from "../utils/companyNavigation";
export function CompanyCard({company}:{company:Company}){const Icon=company.isPrimary?Building2:Building;return <ModuleLink href={companyHref(company.id)} aria-label={"Abrir "+company.name} className={"company-card "+(company.isPrimary?"company-card-main":"")}>
 <div className="company-card-top"><span className={"company-card-icon "+(company.logoUrl?"has-logo":"")}>{company.logoUrl?<Image src={company.logoUrl} alt="" width={32} height={32} unoptimized/>:<Icon size={19} strokeWidth={1.7}/>}</span><span className={"company-kind "+(company.isPrimary?"kind-main":"")}>{company.isPrimary?"Principal":"Unidade"}</span><ArrowUpRight size={15} className="company-open-icon"/></div>
 <h3 title={company.name}>{company.name}</h3><p className="company-cnpj">{company.cnpj?formatCnpj(company.cnpj):"CNPJ não informado"}</p><div className="company-card-bottom"><MapPin size={13}/><span>{[company.city,company.state].filter(Boolean).join(" · ")||"Endereço não informado"}</span></div>
 </ModuleLink>}
