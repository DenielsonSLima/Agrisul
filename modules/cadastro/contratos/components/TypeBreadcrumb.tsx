import {ChevronRight,ArrowLeft} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {contractTypesHref} from '../utils/typeNavigation';
export function TypeBreadcrumb({name}:{name?:string}){return <div className="client-navigation"><nav className="client-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><ChevronRight size={13}/>{name?<><ModuleLink href={contractTypesHref}>Tipos de contrato</ModuleLink><ChevronRight size={13}/><span aria-current="page" title={name}>{name}</span></>:<span aria-current="page">Tipos de contrato</span>}</nav>{name&&<ModuleLink className="client-back" href={contractTypesHref}><ArrowLeft size={15}/>Voltar aos tipos</ModuleLink>}</div>;}
