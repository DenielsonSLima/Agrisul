import {ArrowLeft,ChevronRight} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import type {QuoteItem,QuoteProvider} from '../types';

export const listHref='/cotacao';
export const newHref='/cotacao?nova=1';
export const today=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
export const emptyItem=():QuoteItem=>({id:crypto.randomUUID(),materialId:'',materialVariantId:null,materialName:'',materialCode:'',materialApplication:'',materialReferences:[],quantity:'',unit:'',notes:''});

export function QuotationBreadcrumb({name}:{name?:string}){return <div className="client-navigation"><nav className="client-breadcrumb" aria-label="Caminho de navegação">{name?<><ModuleLink href={listHref}>Cotações</ModuleLink><ChevronRight size={14}/><span aria-current="page">{name}</span></>:<span aria-current="page">Cotações</span>}</nav>{name&&<ModuleLink className="client-back" href={listHref}><ArrowLeft size={15}/>Voltar para cotações</ModuleLink>}</div>;}
export function quotationEmailHref(title:string,number:string,provider:QuoteProvider){const subject=`Solicitação de cotação ${number||title}`,body=`Olá, ${provider.providerName}.\n\nSegue a solicitação de cotação "${title}". Por favor, informe os valores e condições comerciais.\n\nImportante: vou anexar o PDF da solicitação a este e-mail.`;return `mailto:${encodeURIComponent(provider.providerEmail||'')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;}
export function quotationWhatsAppHref(title:string,number:string,provider:QuoteProvider){const phone=(provider.providerPhone||'').replace(/\D/g,'');const message=`Olá, ${provider.providerName}. Segue a solicitação de cotação "${title}"${number?` (${number})`:''}. Vou anexar o PDF com os materiais e quantidades.`;return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;}
