import {ChevronRight,ArrowLeft} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
export const plotsHref='/cadastro?secao=fazenda';
export function PlotBreadcrumb({farmName}:{farmName?:string}){return <div className="client-navigation"><nav className="client-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><ChevronRight size={13}/>{farmName?<><ModuleLink href={plotsHref}>Fazendas</ModuleLink><ChevronRight size={13}/><span aria-current="page" title={farmName}>{farmName}</span></>:<span aria-current="page">Fazendas</span>}</nav>{farmName&&<ModuleLink href={plotsHref} className="client-back"><ArrowLeft size={15}/>Voltar às fazendas</ModuleLink>}</div>;}
