import {ArrowLeft,ChevronRight} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {contractsHref} from '../utils/contractFormat';
type BreadcrumbParent={name:string;href:string};
export function ContractBreadcrumb({name,parent,back=contractsHref,backLabel='Voltar para contratos'}:{name?:string;parent?:BreadcrumbParent;back?:string;backLabel?:string}){return <div className="client-navigation"><nav className="client-breadcrumb" aria-label="Navegação estrutural">{name?<><ModuleLink href={contractsHref}>Contratos</ModuleLink>{parent&&<><ChevronRight size={14}/><ModuleLink href={parent.href}>{parent.name}</ModuleLink></>}<ChevronRight size={14}/><span aria-current="page">{name}</span></>:<span aria-current="page">Contratos</span>}</nav>{name&&<ModuleLink className="client-back" href={back}><ArrowLeft size={15}/>{backLabel}</ModuleLink>}</div>;}
