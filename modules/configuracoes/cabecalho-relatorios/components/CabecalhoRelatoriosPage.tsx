import Link from "next/link";
import {Loader2,RefreshCw,Save} from "lucide-react";
import {activeReportHeader} from "../types";
import {useReportHeader} from "../hooks/useReportHeader";
import {ReportHeaderForm} from "../forms/ReportHeaderForm";
import {ReportHeaderPreview} from "./ReportHeaderPreview";

export function CabecalhoRelatoriosPage(){
 const model=useReportHeader();const active=activeReportHeader(model.settings);
 const save=async()=>{try{await model.save();}catch{/* Hook keeps operation feedback consistent. */}};
 return <section className="report-workspace"><div className="companies-heading"><div><h2>Cabeçalho de relatórios</h2><p>Defina a identidade padrão dos documentos em retrato e paisagem.</p></div>{model.authRequired?<Link className="btn company-primary" href="/login?returnTo=%2Fconfiguracoes%3Fsecao%3Dcabecalho-relatorios">Entrar para salvar</Link>:<button className="btn company-primary" disabled={model.loading||model.saving||!!model.error||!model.dirty} onClick={()=>{void save();}}>{model.saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {model.saving?"Salvando…":"Salvar modelos"}</button>}</div>
  {model.operationError&&<p className="form-error" role="alert">{model.operationError}</p>}
  {model.loading?<div className="report-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando modelos e identidade visual…</div>:model.error?<div className="report-load-error" role="alert"><span>{model.error}</span><button className="btn small" onClick={()=>{void model.reload();}}><RefreshCw size={14}/>Tentar novamente</button></div>:<div className="report-layout"><ReportHeaderForm settings={model.settings} companies={model.companies} disabled={model.saving||model.authRequired} onChange={model.change} onVariantChange={model.changeVariant}/><ReportHeaderPreview orientation={model.settings.orientation} header={active} company={model.company} watermark={model.watermark} issuer={model.issuer} issuedAt={model.issuedAt}/></div>}
 </section>;
}
