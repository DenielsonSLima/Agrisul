'use client';
import {useRef, useState} from 'react';
import {ArrowUpRight, CalendarDays, Eye, MapPin, Paperclip, UserRound, Wrench} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {providerDocument} from '@/modules/cadastro/prestadores/presentation';
import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import type {ServiceRequest} from '../types';
import {RequestWorkflowBadge, requestTimestamp} from './RequestPresentation';
import {RequestAttachmentPreview} from './RequestAttachmentPreview';
import '../cards.css';

export function ServiceRequestCard({request, href}: {request: ServiceRequest; href: string}) {
  const details = request.currentDetails ?? request;
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null);
  const location = [request.provider?.city, request.provider?.state].filter(Boolean).join(' / ');
  return <article className="request-service-card">
    <div className="request-card-top"><span className="request-card-number">SOLICITAÇÃO Nº {request.number}</span><RequestWorkflowBadge status={request.workflowStatus}/></div>
    <div className="request-card-title"><span className="request-card-icon"><Wrench size={20}/></span><div><h3><ModuleLink href={href} className="request-card-link" aria-label={`Abrir solicitação número ${request.number} — ${request.companyName}`}>{request.companyName}</ModuleLink></h3><p className="request-card-document">{request.provider ? `${request.provider.documentType}: ${providerDocument(request.provider)}` : 'Documento não informado'}</p></div><ArrowUpRight size={15} className="request-card-arrow"/></div>
    <div className="request-card-location"><MapPin size={14}/><span>{location || 'Cidade / UF não informadas'}</span></div>
    <div className="request-card-person"><UserRound size={14}/><div><span>Solicitante</span><strong>{request.requester.name}</strong></div></div>
    <p className="request-card-service">{request.items[0]?.description || 'Serviço solicitado'}{request.items.length > 1 && <span> · +{request.items.length - 1} {request.items.length === 2 ? 'serviço' : 'serviços'}</span>}</p>
    <dl className="request-card-details"><div><dt>Valor do serviço</dt><dd>{moneyLabel(details.serviceValue)}</dd></div><div><dt>Previsão de retorno</dt><dd>{details.returnDate ? dateLabel(details.returnDate) : 'Não informada'}</dd></div></dl>
    <div className={`request-card-budget ${request.attachments.length ? 'has-budget' : ''}`}><span><Paperclip size={14}/>{request.attachments.length ? `${request.attachments.length} ${request.attachments.length === 1 ? 'orçamento anexado' : 'orçamentos anexados'}` : 'Sem orçamento anexado'}</span>{!!request.attachments.length && <button ref={previewButton} className="request-card-preview" type="button" onClick={() => setPreviewOpen(true)} aria-label={`Visualizar orçamentos da solicitação ${request.number}`}><Eye size={15}/>Visualizar</button>}</div>
    <div className="request-card-footer"><span><CalendarDays size={13}/><time dateTime={request.createdAt}>{requestTimestamp(request.createdAt)}</time></span><span>Abrir solicitação <ArrowUpRight size={13}/></span></div>
    {previewOpen && <RequestAttachmentPreview files={request.attachments} requestNumber={request.number} onClose={() => setPreviewOpen(false)} onCloseAutoFocus={event => {event.preventDefault(); previewButton.current?.focus();}}/>}
  </article>;
}
