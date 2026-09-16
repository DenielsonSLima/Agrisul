import {ArrowLeft,ChevronRight} from "lucide-react";
import {ModuleLink} from "@/shared/navigation/ModuleNavigation";
import {companiesHref} from "../utils/companyNavigation";

export function CompanyBreadcrumb({current}:{current?:string}){
 return <div className="client-navigation company-navigation"><nav aria-label="Caminho de navegação" className="client-breadcrumb"><ModuleLink href="/configuracoes">Configurações</ModuleLink><ChevronRight size={13}/>{current?<><ModuleLink href={companiesHref}>Empresas</ModuleLink><ChevronRight size={13}/><span aria-current="page" title={current}>{current}</span></>:<span aria-current="page">Empresas</span>}</nav>{current&&<ModuleLink href={companiesHref} className="client-back"><ArrowLeft size={15}/>Voltar para empresas</ModuleLink>}</div>;
}
