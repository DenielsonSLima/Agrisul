import {CheckCircle2, CircleDot, Clock3, Loader2, RefreshCw, XCircle} from 'lucide-react';
import type {RequestStatus, RequestWorkflowStatus} from '../types';

export const requestStatusLabel: Record<RequestStatus, string> = {pending: 'Pendente', approved: 'Aprovada', rejected: 'Recusada'};
export function requestTimestamp(value: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo'}).format(new Date(value));
}
export function RequestStatusBadge({status}: {status: RequestStatus}) {
  const Icon = status === 'approved' ? CheckCircle2 : status === 'rejected' ? XCircle : Clock3;
  return <span className={`request-status request-status-${status}`}><Icon size={14}/>{requestStatusLabel[status]}</span>;
}
export const requestWorkflowLabel: Record<RequestWorkflowStatus, string> = {open: 'Aberto', in_progress: 'Em andamento', finished: 'Finalizado', rejected: 'Recusado'};
export function RequestWorkflowBadge({status}: {status?: RequestWorkflowStatus}) {
  if (!status) return null;
  const Icon = status === 'open' ? Clock3 : status === 'in_progress' ? CircleDot : status === 'finished' ? CheckCircle2 : XCircle;
  return <span className={`request-status request-workflow-${status}`}><Icon size={14}/>{requestWorkflowLabel[status]}</span>;
}
export function RequestLoading({label = 'Carregando solicitações…'}: {label?: string}) {
  return <div className="request-empty" role="status"><Loader2 className="animate-spin" size={24}/><p>{label}</p></div>;
}
export function RequestError({error, onRetry}: {error: string; onRetry: () => void}) {
  return <div className="request-empty" role="alert"><XCircle size={26}/><h3>Não foi possível carregar</h3><p>{error}</p><button type="button" className="btn" onClick={onRetry}><RefreshCw size={16}/>Tentar novamente</button></div>;
}
