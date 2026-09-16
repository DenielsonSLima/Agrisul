'use client';
import {useState} from 'react';
import {CalendarDays, ChevronLeft, ChevronRight, FileDown} from 'lucide-react';
import {useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {BillingQueryState} from '@/shared/components/BillingQueryState';
import {localDay, monthLabel} from '@/shared/utils/presentation';
import {useAgenda} from '../hooks/useAgenda';
import {EventList} from './EventList';
import {AgendaLegend} from './AgendaLegend';
import {MonthCalendar} from './MonthCalendar';
import {AgendaExportDialog} from './AgendaExportDialog';
import type {AgendaKind,AgendaSnapshot} from '../types';
import '../styles.css';

export function AgendaPage() {
  const {searchParams, navigate} = useModuleNavigation();
  const requested = searchParams.get('dia') ?? '';
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested >= '1900-01-01' && requested <= '9998-12-31' && !Number.isNaN(Date.parse(requested)) && localDay(new Date(`${requested}T12:00:00`)) === requested;
  const selectedDay = validDay ? requested : localDay();
  const month = selectedDay.slice(0, 7);
  const [kind, setKind] = useState<AgendaKind | ''>('');
  const [snapshot, setSnapshot] = useState<AgendaSnapshot | null>(null);
  const model = useAgenda(month, kind);
  const day = model.data?.days.find(item => item.date === selectedDay);
  const selectDay = (value: string) => navigate(`/agenda?dia=${value}`);
  const changeMonth = (offset: number) => {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth() + offset);
    selectDay(localDay(date));
  };
  return <section className="agenda-page">
    <div className="companies-heading"><div><div className="eyebrow">ROTINA DA EMPRESA</div><h2>Agenda</h2><p>Veja o que aconteceu em cada dia e as próximas datas dos contratos.</p></div><div className="agenda-heading-actions"><span className="agenda-company"><CalendarDays size={17}/>{model.company?.name || 'Sua empresa'}</span><button className="btn company-primary" disabled={!model.data || model.loading || model.isFetching || !!model.errorMessage || model.noCompany} onClick={() => {if(model.data)setSnapshot({data:structuredClone(model.data),companyId:model.companyId,kind});}}><FileDown size={16}/>Exportar PDF</button></div></div>
    <div className="agenda-toolbar"><div className="agenda-month-nav"><button className="btn" aria-label="Mês anterior" disabled={month <= '1900-01'} onClick={() => changeMonth(-1)}><ChevronLeft size={18}/></button><h3>{monthLabel(month)}</h3><button className="btn" aria-label="Próximo mês" disabled={month >= '9998-12'} onClick={() => changeMonth(1)}><ChevronRight size={18}/></button><button className="btn" onClick={() => selectDay(localDay())}>Hoje</button></div><label>Mês<input aria-label="Mês da agenda" type="month" min="1900-01" max="9998-12" value={month} onChange={e => {if(e.target.value) selectDay(`${e.target.value}-01`);}}/></label></div>
    <BillingQueryState {...model}/>
    {model.data && !model.errorMessage && <><div className="agenda-layout" aria-busy={model.isFetching}>
      <MonthCalendar data={model.data} selectedDay={selectedDay} onDay={selectDay} refreshing={model.isFetching}/>
      <div className="agenda-side"><AgendaLegend kind={kind} onKind={setKind}/><EventList day={selectedDay} events={day?.events ?? []}/></div>
    </div><p className="agenda-footnote">Os eventos vêm dos registros da empresa. O cadastro do contrato usa a data de inclusão; início e término usam as datas informadas no contrato. Selecione um evento para abrir o registro.</p></>}
    {snapshot && <AgendaExportDialog snapshot={snapshot} onClose={() => setSnapshot(null)}/>}
  </section>;
}
