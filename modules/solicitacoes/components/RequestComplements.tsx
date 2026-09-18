import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import {History} from 'lucide-react';
import type {ServiceRequest} from '../types';
import {requestTimestamp} from './RequestPresentation';

export function RequestComplements({request}: {request: ServiceRequest}) {
  if (!request.complements?.length) return null;
  return <section className="request-complements"><div className="request-section-heading"><History size={18}/><h3>Complementações da solicitação</h3><span>{request.complements.length}</span></div><p className="field-help">Histórico de valores, prazos e orçamentos adicionados após a criação. O documento original e suas assinaturas permanecem preservados.</p>
    {request.complements.map(entry => <article key={entry.id} className="request-complement-entry"><strong>Registro {entry.version} · {entry.actorName}</strong><p>{requestTimestamp(entry.at)} · Brasília · {entry.recordedStatus === 'pending' ? 'Antes da decisão' : 'Após a aprovação'}</p><dl className="request-document-values"><div><dt>Valor do serviço</dt><dd>{moneyLabel(entry.serviceValue)}</dd></div><div><dt>Previsão de retorno</dt><dd>{entry.returnDate ? dateLabel(entry.returnDate) : 'Não informada'}</dd></div></dl>{!!entry.attachmentIds.length && <p>Orçamentos adicionados: {request.attachments.filter(file => entry.attachmentIds.includes(file.id)).map(file => file.fileName).join(', ')}</p>}<details className="request-audit-details"><summary>Dados do registro</summary><p>Usuário: <code>{entry.actorId}</code></p><p>Hash do complemento: <code>{entry.hash}</code></p></details></article>)}
  </section>;
}
