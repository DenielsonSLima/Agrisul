import {ArrowUpRight, CalendarDays} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {decimalLabel, moneyLabel} from '@/shared/utils/presentation';
import type {AgendaEvent} from '../types';
export function EventList({day, events}: {day: string; events: AgendaEvent[]}) {
  const label = new Intl.DateTimeFormat('pt-BR', {weekday: 'long', day: 'numeric', month: 'long'}).format(new Date(`${day}T12:00:00`));
  return <aside className="agenda-detail" aria-label="Eventos do dia"><div className="agenda-detail-heading"><span>NO DIA SELECIONADO</span><h3>{label}</h3></div>{!events.length ? <div className="agenda-empty"><CalendarDays size={30}/><h4>Nenhum evento neste dia</h4><p>Selecione outra data ou consulte os outros tipos na legenda.</p></div> : <ul>{events.map(event => <li key={event.id}><ModuleLink href={`/contratos?contrato=${event.contractId}&aba=${event.kind === 'load' ? 'loads' : ['receipt','advance','refund'].includes(event.kind) ? 'financial' : 'summary'}`}><div className="agenda-event-title"><i className={`agenda-dot agenda-${event.kind}`}/><strong>{event.title}</strong><ArrowUpRight size={15}/></div><p>{event.detail}</p><small>{event.contractNumber ? `Contrato ${event.contractNumber}` : 'Ver contrato'} · {event.status}</small>{event.volume && <b>{decimalLabel(event.volume)} t</b>}{event.amount && <b>{moneyLabel(event.amount)}</b>}</ModuleLink></li>)}</ul>}</aside>;
}
