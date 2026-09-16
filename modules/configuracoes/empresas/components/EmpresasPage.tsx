import Link from "next/link";
import {useState} from "react";
import {Plus,Building2,RefreshCw,ArrowRight,Check,Search} from "lucide-react";
import {Skeleton} from "@/components/ui/skeleton";
import {LocalSearch} from "@/shared/components/Common";
import {ModuleLink,useModuleNavigation} from "@/shared/navigation/ModuleNavigation";
import {normalize} from "@/shared/utils/format";
import {useCompanies} from "../hooks/useCompanies";
import {CompanyForm} from "../forms/CompanyForm";
import {CompanyCard} from "./CompanyCard";
import {CompanyBreadcrumb} from "./CompanyBreadcrumb";
import {newCompanyHref} from "../utils/companyNavigation";

export function EmpresasPage(){
 const m=useCompanies();const{searchParams}=useModuleNavigation();const[q,setQ]=useState("");
 const companyId=searchParams.get("empresa");const creating=searchParams.get("acao")==="nova";const saved=searchParams.get("salvo")==="1";const primary=m.companies.find(company=>company.isPrimary);const company=companyId?m.companies.find(item=>item.id===companyId):undefined;
 if(creating)return <section className="companies-section"><CompanyBreadcrumb current="Nova empresa"/><div className="companies-heading company-page-heading"><div><h2>Cadastrar empresa</h2><p>Adicione a logo, consulte o CNPJ e revise os dados antes de salvar.</p></div></div>{m.authRequired?<CompanyAccess/>:m.loading?<CompanyFormSkeleton/>:m.error?<CompanyLoadError message={m.error} onRetry={m.reload}/>:<CompanyForm hasPrimary={!!primary} onSave={m.save}/>}</section>;
 if(companyId)return <section className="companies-section"><CompanyBreadcrumb current={company?.name||"Editar empresa"}/><div className="companies-heading company-page-heading"><div><h2>Editar empresa</h2><p>{company?.name||"Atualize os dados e a identidade visual da empresa."}</p></div></div>{saved&&<p className="company-saved" role="status"><Check size={16}/>Empresa salva.</p>}{m.authRequired?<CompanyAccess/>:m.loading?<CompanyFormSkeleton/>:m.error?<CompanyLoadError message={m.error} onRetry={m.reload}/>:!company?<div className="company-empty"><span className="company-empty-icon"><Building2 size={25}/></span><h3>Empresa não encontrada</h3><p>O cadastro pode ter sido removido ou pertence a outra conta.</p></div>:<CompanyForm key={company.id+":"+company.updatedAt} company={company} hasPrimary={!!primary} onSave={m.save}/>}</section>;
 const filtered=m.companies.filter(company=>normalize(company.name+" "+company.legalName+" "+company.cnpj).includes(normalize(q)));
 return <section className="companies-section"><CompanyBreadcrumb/><div className="companies-heading"><div><h2>Empresas</h2><p>Organize a empresa principal e suas unidades.</p></div>{!m.authRequired&&<ModuleLink className="btn company-primary" href={newCompanyHref} aria-disabled={m.loading}><Plus size={17}/>Cadastrar empresa</ModuleLink>}</div>
  {saved&&<p className="company-saved" role="status"><Check size={16}/>Empresa salva.</p>}
  {m.authRequired?<CompanyAccess/>:m.loading?<div className="company-grid" aria-label="Carregando empresas" aria-busy="true">{[1,2,3,4].map(value=><Skeleton key={value} className="h-44 rounded-xl"/>)}</div>:m.error?<CompanyLoadError message={m.error} onRetry={m.reload}/>:!m.companies.length?<div className="company-empty"><span className="company-empty-icon"><Building2 size={30}/></span><h3>Cadastre sua empresa principal</h3><p>Depois, adicione as demais unidades. Consulte o CNPJ para preencher os dados automaticamente.</p><ModuleLink className="btn company-primary" href={newCompanyHref}><Plus size={17}/>Cadastrar primeira empresa</ModuleLink></div>:<><div className="companies-toolbar"><LocalSearch value={q} onChange={setQ} placeholder="Buscar empresa ou CNPJ..."/><span>{m.companies.length} empresa{m.companies.length!==1?"s":""}</span></div><div className="company-grid">{filtered.map(item=><CompanyCard key={item.id} company={item}/>)}</div>{!filtered.length&&<div className="empty"><Search size={18}/>Nenhuma empresa encontrada.</div>}</>}
 </section>;
}

function CompanyAccess(){return <div className="company-empty"><span className="company-empty-icon"><Building2 size={30}/></span><h3>Suas empresas, em um só lugar</h3><p>Entre para acessar e salvar os cadastros da sua conta.</p><Link className="btn company-primary" href="/login?returnTo=%2Fconfiguracoes%3Fsecao%3Dempresas">Entrar na conta<ArrowRight size={16}/></Link></div>}
function CompanyFormSkeleton(){return <div className="company-form-skeleton" aria-label="Carregando empresa" aria-busy="true"><Skeleton className="h-28 rounded-xl"/><Skeleton className="h-48 rounded-xl"/><Skeleton className="h-80 rounded-xl"/></div>}
function CompanyLoadError({message,onRetry}:{message:string;onRetry:()=>void}){return <div className="company-empty" role="alert"><h3>Não foi possível carregar</h3><p>{message}</p><button className="btn" onClick={onRetry}><RefreshCw size={16}/>Tentar novamente</button></div>}
