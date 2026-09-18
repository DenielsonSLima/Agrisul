'use client';
/* eslint-disable @next/next/no-img-element -- Private signed originals must bypass the public image optimizer. */
import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, Building2, CalendarDays, Check, CheckCircle2, Clock3, ExternalLink, FileDown, FileText, History, Loader2, MapPin, Paperclip, PenLine, ShieldCheck, Users, Wallet, Wrench, X, XCircle} from 'lucide-react';
import {notifications, useConfirmation} from '@/shared/feedback';
import {providerDocument} from '@/modules/cadastro/prestadores/presentation';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import {useRequestFileUrl} from '../hooks/useServiceRequests';
import {assertRequestActor, requestSignatureBucket} from '../services/requestApi';
import type {RequestActor, RequestDecisionInput, RequestExecution, RequestFile, RequestOptions, RequestSigningMode, ServiceRequest} from '../types';
import {RequestStatusBadge, RequestWorkflowBadge, requestTimestamp} from './RequestPresentation';
import {SigningModeChoice} from './SigningModeChoice';
import {RequestDocumentPreview} from './RequestDocumentPreview';
import {RequestVerification} from './RequestVerification';
import {RequestComplementForm} from '../forms/RequestComplementForm';
import {RequestComplements} from './RequestComplements';
import {RequestCompletionAction} from './RequestCompletionAction';
import '../document.css';
import '../detail.css';

function SignatureBlock({actor, at, label}: {actor: RequestActor | null; at: string | null; label: string}) {
  const manual = actor?.signingMode === 'manual' || !!actor && !actor.signaturePath;
  const signature = useRequestFileUrl(requestSignatureBucket, manual ? null : actor?.signaturePath);
  return <div className="request-person-card">
    <span className="request-person-role">{label}</span>
    <strong>{actor?.name || 'Aguardando análise'}</strong>
    {actor ? <>
      <span className="request-person-signing">{manual ? <PenLine size={14}/> : <ShieldCheck size={14}/>} {manual ? 'Assinatura manual após impressão' : 'Assinatura cadastrada'}</span>
      {!manual && <div className="request-person-image">{signature.isPending ? <Loader2 className="animate-spin" size={18} aria-label="Carregando assinatura"/> : signature.data ? <img src={signature.data} alt={`Assinatura de ${actor.name}`} width={220} height={90}/> : <button className="request-text-button" type="button" onClick={() => void signature.refetch()}>Recarregar assinatura</button>}</div>}
      {at && <time dateTime={at}>{requestTimestamp(at)} · Brasília</time>}
      {(actor.signatureHash || label === 'Diretor geral' && actor.userId) && <details className="request-audit-details"><summary>Dados do registro</summary>{label === 'Diretor geral' && actor.userId && <p>Usuário: <code>{actor.userId}</code></p>}{actor.signatureHash && <p className="request-signature-hash">Hash da assinatura: <code>{actor.signatureHash}</code></p>}</details>}
    </> : <span className="request-person-signing"><Clock3 size={14}/>A decisão será registrada nesta solicitação.</span>}
  </div>;
}

function RequestAttachment({file}: {file: RequestFile}) {
  const url = useRequestFileUrl(file.bucket, file.path);
  return <li><span className="request-file-icon"><FileText size={22}/></span><div><strong>{file.fileName}</strong><small>{file.contentType === 'application/pdf' ? 'PDF' : 'Imagem'} · {new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1}).format(file.size / 1024)} KB</small></div>{url.data ? <a className="btn" href={url.data} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${file.fileName}`}><ExternalLink size={15}/><span>Abrir</span></a> : url.isError ? <button className="btn" onClick={() => void url.refetch()}>Tentar novamente</button> : <Loader2 size={18} className="animate-spin" aria-label="Preparando arquivo"/>}</li>;
}

export function ServiceRequestDetail({request, options, onBack, onDecide, deciding}: {
  request: ServiceRequest;
  options: RequestOptions;
  onBack: () => void;
  onDecide: (input: RequestDecisionInput, execution: RequestExecution) => Promise<ServiceRequest>;
  deciding: boolean;
}) {
  const confirm = useConfirmation();
  const [reason, setReason] = useState('');
  const [signingChoice, setSigningChoice] = useState<RequestSigningMode>(options.managerSignature?.filePath ? 'registered' : 'manual');
  const managerSigningMode = options.managerSignature?.filePath ? signingChoice : 'manual';
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [complementing, setComplementing] = useState(false);
  const complementTrigger = useRef<HTMLButtonElement | null>(null);
  const openComplement = (button: HTMLButtonElement) => {complementTrigger.current = button; setComplementing(true);};
  const [confirming, setConfirming] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const exportOperation = useRef<AbortController | null>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => {operation.current?.abort(); exportOperation.current?.abort();}, []);
  const busy = deciding || confirming;
  const current = request.currentDetails ?? request;
  const history = [...request.history, ...(request.complements ?? []).map(entry => ({id: entry.id, action: 'complemented', actorId: entry.actorId, actorName: entry.actorName, at: entry.at, reason: `Valor: ${moneyLabel(entry.serviceValue)} · Retorno: ${entry.returnDate ? dateLabel(entry.returnDate) : 'não informado'} · ${entry.attachmentIds.length} novo(s) anexo(s)`}))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  async function decide(decision: 'approved' | 'rejected') {
    if (busy) return;
    if (decision === 'rejected' && reason.trim().length < 3) {setError('Informe o motivo da recusa com pelo menos três caracteres.'); return;}
    setError(''); setConfirming(true);
    const controller = new AbortController(); operation.current = controller;
    const execution = {actorId: options.actorId, signal: controller.signal};
    try {
      const approved = decision === 'approved';
      const accepted = await confirm({title: `${approved ? 'Aprovar' : 'Recusar'} solicitação nº ${request.number}?`, description: `A decisão será registrada com seu usuário e data e hora. ${managerSigningMode === 'manual' ? 'O documento terá espaço para assinatura manual do diretor geral.' : 'A imagem cadastrada da assinatura do diretor geral será incluída.'} A solicitação será finalizada${approved ? '.' : ' com o motivo informado.'}`, confirmLabel: approved ? 'Aprovar solicitação' : 'Recusar solicitação', tone: approved ? 'default' : 'destructive'});
      if (!accepted) return;
      await assertRequestActor(execution);
      await onDecide({id: request.id, decision, reason, managerSigningMode, expectedComplementId: request.complements.at(-1)?.id ?? null}, execution);
      await assertRequestActor(execution);
      setReason('');
      notifications.saved(approved ? `A solicitação foi aprovada.${managerSigningMode === 'manual' ? ' O documento está pronto para assinatura manual.' : ' A assinatura do diretor geral foi registrada.'}` : 'A solicitação foi recusada e o motivo ficou registrado.');
    } catch (caught) {if (controller.signal.aborted || caught instanceof DOMException && caught.name === 'AbortError') return; const message = caught instanceof Error ? caught.message : 'Não foi possível registrar a decisão.'; setError(message); notifications.error(message);}
    finally {if (!controller.signal.aborted) setConfirming(false); if (operation.current === controller) operation.current = null;}
  }

  async function exportPdf() {
    if (exporting) return;
    setExporting(true);
    const controller = new AbortController(); exportOperation.current = controller;
    try {const {createServiceRequestPdf} = await import('../reporting/serviceRequestPdf'); await createServiceRequestPdf(structuredClone(request), {actorId: options.actorId, signal: controller.signal});}
    catch (caught) {if (controller.signal.aborted || caught instanceof DOMException && caught.name === 'AbortError') return; notifications.error(caught instanceof Error ? caught.message : 'Não foi possível gerar o PDF.');}
    finally {if (!controller.signal.aborted) setExporting(false); if (exportOperation.current === controller) exportOperation.current = null;}
  }

  return <div className="request-detail">
    <button type="button" className="request-back" onClick={onBack} disabled={busy}><ArrowLeft size={16}/>Voltar para serviços</button>
    <div className="request-heading"><div><span className="eyebrow">SOLICITAÇÃO DE SERVIÇO</span><div className="request-detail-title"><h2>Solicitação nº {request.number}</h2><RequestWorkflowBadge status={request.workflowStatus}/></div><p>{request.requester.name} <span aria-hidden="true">·</span> Registrada em {requestTimestamp(request.createdAt)} · Brasília</p></div><div className="request-heading-actions"><RequestCompletionAction request={request} actorId={options.actorId}/><button ref={previewButton} className="btn" type="button" onClick={() => setPreviewOpen(true)}><FileText size={16}/>Prévia do documento</button><button className="btn request-export-button" type="button" disabled={exporting} onClick={() => void exportPdf()}>{exporting ? <Loader2 size={16} className="animate-spin"/> : <FileDown size={16}/>}Exportar PDF</button></div></div>
    {previewOpen && <RequestDocumentPreview request={request} actorId={options.actorId} open={previewOpen} onClose={() => setPreviewOpen(false)} onCloseAutoFocus={event => {event.preventDefault(); if (previewButton.current?.isConnected) previewButton.current.focus();}}/>}
    {complementing && request.canComplement && <RequestComplementForm request={request} actorId={options.actorId} onClose={() => setComplementing(false)} onCloseAutoFocus={event => {event.preventDefault(); complementTrigger.current?.focus();}}/>}
    <section className="request-current-details" aria-label="Resumo da solicitação">
      <dl className="request-summary-metrics">
        <div><span className="request-metric-icon"><Wallet size={18}/></span><div><dt>Valor atual do serviço</dt><dd>{moneyLabel(current.serviceValue)}</dd></div></div>
        <div><span className="request-metric-icon"><CalendarDays size={18}/></span><div><dt>Previsão de retorno</dt><dd>{current.returnDate ? dateLabel(current.returnDate) : 'Não informada'}</dd></div></div>
        <div><span className="request-metric-icon"><Paperclip size={18}/></span><div><dt>Orçamentos anexados</dt><dd>{request.attachments.length} <span>{request.attachments.length === 1 ? 'arquivo' : 'arquivos'}</span></dd></div></div>
      </dl>
      <div className="request-summary-footer"><p>{request.status === 'pending' ? 'Inclua ou atualize o valor, a previsão de retorno e os arquivos do orçamento.' : request.status === 'approved' ? 'Complementações ficam registradas no histórico desta solicitação.' : 'Consulte o motivo da recusa no painel de decisão.'}</p>{request.canComplement && <button type="button" className="btn" onClick={event => openComplement(event.currentTarget)}>Complementar dados</button>}</div>
    </section>
    <div className="request-detail-grid"><div className="request-detail-main">
      <section className="request-info-card request-provider-card" aria-labelledby="request-provider-title">
        <div className="request-section-heading"><Building2 size={18}/><h3 id="request-provider-title">Prestador do serviço</h3></div>
        <strong className="request-provider-name">{request.companyName}</strong>
        {request.provider && <span className="request-provider-document">{request.provider.documentType}: {providerDocument(request.provider)}</span>}
        <p className="request-provider-address"><MapPin size={15}/>{request.companyAddress || 'Endereço não informado'}</p>
      </section>
      <section className="request-info-card request-services-card" aria-labelledby="request-services-title">
        <div className="request-section-heading"><Wrench size={18}/><h3 id="request-services-title">Serviços solicitados</h3><span>{request.items.length} {request.items.length === 1 ? 'item' : 'itens'}</span></div>
        <div className="request-services-table-wrap"><table className="request-services-table"><thead><tr><th scope="col">Equipamento / material / serviço</th><th scope="col">Aplicação</th></tr></thead><tbody>{request.items.map((item, index) => <tr key={index}><td><span className="request-item-number">{String(index + 1).padStart(2, '0')}</span><span>{item.description}</span></td><td>{item.application}</td></tr>)}</tbody></table></div>
        {request.notes && <div className="request-detail-notes"><h4>Observações</h4><p>{request.notes}</p></div>}
      </section>
      <section className="request-info-card" aria-labelledby="request-people-title"><div className="request-section-heading"><Users size={18}/><h3 id="request-people-title">Responsáveis e assinaturas</h3></div><div className="request-people-grid"><SignatureBlock actor={request.requester} at={request.createdAt} label="Solicitante"/><SignatureBlock actor={request.decision} at={request.decision?.at ?? null} label="Diretor geral"/></div>{request.createdBy && <p className="request-registration-note">Registrado no sistema por <strong>{request.createdBy.name}</strong>.</p>}</section>
      <section className="request-attachments"><div className="request-budget-actions"><div className="request-section-heading"><Paperclip size={18}/><h3>Orçamentos anexados</h3><span>{request.attachments.length}</span></div>{request.canComplement && <button type="button" className="btn" onClick={event => openComplement(event.currentTarget)}><Paperclip size={14}/>Anexar orçamento</button>}</div>{request.attachments.length ? <ul>{request.attachments.map(file => <RequestAttachment key={file.id} file={file}/>)}</ul> : <p className="field-help">Nenhum orçamento foi anexado a esta solicitação.</p>}</section>
      <RequestComplements request={request}/>
      <RequestVerification request={request}/>
      <details className="request-audit-details request-record-details"><summary>Dados do registro original</summary><p>Solicitação: <code>{request.id}</code></p>{request.createdBy && <p>Usuário responsável pelo lançamento: <code>{request.createdBy.userId}</code></p>}{!!request.complements?.length && <p>Valor no registro original: {moneyLabel(request.serviceValue)}<br/>Previsão de retorno original: {request.returnDate ? dateLabel(request.returnDate) : 'Não informada'}</p>}</details>
    </div><aside className="request-detail-aside">
      <section className={`request-decision-card request-decision-${request.status}`}><div className="request-section-heading">{request.status === 'pending' ? <Clock3 size={19}/> : request.status === 'rejected' ? <XCircle size={19}/> : <CheckCircle2 size={19}/>}<h3>{request.status === 'pending' ? 'Análise do diretor geral' : 'Decisão registrada'}</h3></div>
        {request.status !== 'pending' && request.decision ? <><RequestStatusBadge status={request.status}/><p><strong>{request.decision.name}</strong><br/>{requestTimestamp(request.decision.at)} · Brasília</p><p>{request.decision.signingMode === 'manual' ? 'Assinatura manual após impressão.' : 'Assinatura cadastrada incluída no documento.'}</p>{request.decision.reason && <div className="request-decision-reason"><span>{request.status === 'rejected' ? 'Motivo da recusa' : 'Observação da aprovação'}</span><p>{request.decision.reason}</p></div>}</> : request.canDecide ? <><p>Diretor geral: <strong>{options.managerSignature?.name}</strong>.</p><SigningModeChoice name="manager-signing-mode" value={managerSigningMode} hasImage={!!options.managerSignature?.filePath} disabled={busy} onChange={setSigningChoice}/><label className="field"><span>Observação / motivo da recusa</span><textarea rows={4} maxLength={2000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="Para recusar, informe o motivo."/></label>{error && <p className="request-inline-error" role="alert">{error}</p>}<div className="request-decision-buttons"><button className="btn company-primary" type="button" disabled={busy} onClick={() => void decide('approved')}>{busy ? <Loader2 size={16} className="animate-spin"/> : <Check size={17}/>}Aprovar solicitação</button><button className="btn request-reject" type="button" disabled={busy} onClick={() => void decide('rejected')}><X size={17}/>Recusar</button></div></> : <><p>{options.canDecide && !options.managerSignature ? 'Cadastre o diretor geral e vincule sua conta para registrar a decisão. A imagem PNG é opcional.' : 'Esta solicitação está aguardando a análise do diretor geral.'}</p>{options.canDecide && !options.managerSignature && <ModuleLink href="/cadastro?secao=assinaturas" className="request-text-button">Abrir assinaturas</ModuleLink>}</>}
      </section>
      <section className="request-history"><div className="request-section-heading"><History size={18}/><h3>Histórico</h3></div><ol>{history.map(entry => <li key={entry.id}><span className={`request-timeline-dot ${entry.action === 'rejected' ? 'is-rejected' : ''}`}/><div><strong>{entry.action === 'completed' ? 'Serviço finalizado' : entry.action === 'complemented' ? 'Dados complementados' : entry.action === 'approved' ? 'Solicitação aprovada' : entry.action === 'rejected' ? 'Solicitação recusada' : 'Solicitação registrada'}</strong><p>{entry.actorName}</p><time dateTime={entry.at}>{requestTimestamp(entry.at)}</time>{entry.reason && <p className="request-history-reason">{entry.reason}</p>}<details className="request-audit-details"><summary>Identificação do usuário</summary><code>{entry.actorId}</code></details></div></li>)}</ol><span className="request-timezone">Horários de Brasília (UTC−03:00)</span></section>
    </aside></div>
  </div>;
}

