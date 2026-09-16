import {ArrowLeft,ChevronRight} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {clientsHref} from '../utils/clientFormat';
export function ClientBreadcrumb({name}:{name?:string}){return <div className="client-navigation"><nav aria-label="Caminho de navegação" className="client-breadcrumb"><ModuleLink href="/cadastro">Cadastros</ModuleLink><ChevronRight size={13}/>{name?<><ModuleLink href={clientsHref}>Clientes</ModuleLink><ChevronRight size={13}/><span aria-current="page" title={name}>{name}</span></>:<span aria-current="page">Clientes</span>}</nav>{name&&<ModuleLink href={clientsHref} className="client-back"><ArrowLeft size={15}/>Voltar para clientes</ModuleLink>}</div>;}
