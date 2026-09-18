'use client';
import {useState, type FormEvent} from 'react';
import {Search, SlidersHorizontal, X} from 'lucide-react';
import type {RequestFilters as Filters, RequestOptions} from '../types';

export function RequestFilters({filters, requesters, onApply}: {filters: Filters; requesters: RequestOptions['requesters']; onApply: (next: Partial<Filters>) => void}) {
  const [search, setSearch] = useState(filters.search);
  const [dateFrom, setDateFrom] = useState(filters.dateFrom);
  const [dateTo, setDateTo] = useState(filters.dateTo);
  const [requesterId, setRequesterId] = useState(filters.requesterId);
  const [error, setError] = useState('');
  const active = !!(filters.search || filters.dateFrom || filters.dateTo || filters.requesterId);
  function submit(event: FormEvent) {event.preventDefault(); if (dateFrom && dateTo && dateFrom > dateTo) {setError('A data final deve ser igual ou posterior à data inicial.'); return;} setError(''); onApply({search, dateFrom, dateTo, requesterId, page: 1});}
  return <form className="request-filters" onSubmit={submit} aria-label="Filtros das solicitações"><div className="request-filter-search"><label htmlFor="request-search">Buscar solicitação</label><div><Search size={17}/><input id="request-search" type="search" value={search} maxLength={160} onChange={event => setSearch(event.target.value)} placeholder="Número, empresa ou serviço…"/></div></div><label className="request-filter-field"><span>De</span><input type="date" aria-label="Início do período" value={dateFrom} onChange={event => setDateFrom(event.target.value)}/></label><label className="request-filter-field"><span>Até</span><input type="date" aria-label="Fim do período" value={dateTo} onChange={event => setDateTo(event.target.value)}/></label><label className="request-filter-field request-filter-requester"><span>Solicitante</span><select value={requesterId} onChange={event => setRequesterId(event.target.value)}><option value="">Todos os solicitantes</option>{requesters.map(requester => <option key={requester.id} value={requester.id}>{requester.name}</option>)}</select></label><button type="submit" className="btn"><SlidersHorizontal size={16}/>Filtrar</button>{active && <button type="button" className="request-icon-button" aria-label="Limpar filtros" title="Limpar filtros" onClick={() => onApply({search: '', dateFrom: '', dateTo: '', requesterId: '', page: 1})}><X size={17}/></button>}{error && <p className="request-inline-error" role="alert">{error}</p>}</form>;
}
