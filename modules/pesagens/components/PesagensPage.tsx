'use client';
import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, CalendarDays, ChevronDown, Download, FileText, Info, Loader2, Pencil, Plus, RefreshCw, Scale, Search, Trash2, Truck} from 'lucide-react';
import {ModuleLink, useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {notifications, useConfirmation} from '@/shared/feedback';
import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import {dateLabel} from '@/shared/utils/presentation';
import {useWeighings, useWeighingMutations} from '../hooks/useWeighings';
import {percentLabel, weightLabel} from '../utils/presentation';
import {exportWeighingXlsx} from '../reporting/weighingXlsx';
import {createWeighingPdf} from '../reporting/weighingPdf';
import {WeighingControlDialog} from './WeighingControlDialog';
import {WeighingEntryDialog} from './WeighingEntryDialog';
import type {WeighingDetail, WeighingEntry, WeighingSummary, WeighingFilters} from '../types';
import '../styles.css';

const href = (id: string) => `/pesagens?controle=${encodeURIComponent(id)}`;

export function PesagensPage() {
  const {user} = useAuth();
  const {activeCompanyId} = useWorkspaceCompany();
  const {searchParams} = useModuleNavigation();
  const id = searchParams.get('controle') ?? '';
  return <WeighingWorkspace key={`${user?.id ?? ''}:${activeCompanyId}:${id}`} id={id}/>;
}

function WeighingMetrics({summary, partner}: {summary: WeighingSummary; partner: string}) {
  return <div className="weighing-metrics">
    <article><span>VIAGENS</span><strong>{summary.entryCount}</strong><small>{summary.pendingCount ? `${summary.pendingCount} com dados pendentes` : 'Comparativo preenchido'}</small></article>
    <article><span>LÍQUIDO AGRISUL</span><strong>{weightLabel(summary.agrisulNetKg)} <em>kg</em></strong><small>Viagens com pesos completos</small></article>
    <article><span>LÍQUIDO {partner}</span><strong>{weightLabel(summary.partnerNetKg)} <em>kg</em></strong><small>Pesos informados pelo parceiro</small></article>
    <article className="weighing-metric-difference"><span>DIFERENÇA</span><strong>{weightLabel(summary.differenceKg)}{summary.differenceKg != null && <em>kg</em>}</strong><small>{summary.differencePercent == null ? 'Complete os pesos para comparar' : `${percentLabel(summary.differencePercent)} em relação à AGRISUL`}</small></article>
  </div>;
}

function WeighingWorkspace({id}: {id: string}) {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<WeighingFilters>({search: '', dateFrom: '', dateTo: '', pendingOnly: false});
  const validPeriod = !dateFrom || !dateTo || dateFrom <= dateTo;
  useEffect(() => {
    if (!validPeriod) return;
    const timer = setTimeout(() => setAppliedFilters({search: search.trim(), dateFrom, dateTo, pendingOnly}), 250);
    return () => clearTimeout(timer);
  }, [search, dateFrom, dateTo, pendingOnly, validPeriod]);
  const model = useWeighings(id || undefined, appliedFilters);
  const mutations = useWeighingMutations();
  const confirm = useConfirmation();
  const {navigate} = useModuleNavigation();
  const [controlDialog, setControlDialog] = useState(false);
  const [entryDialog, setEntryDialog] = useState<{entry?: WeighingEntry} | null>(null);
  const [actionError, setActionError] = useState('');
  const [pdfSnapshot, setPdfSnapshot] = useState<WeighingDetail | null>(null);
  const mounted = useRef(true), deleting = useRef(false);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const detail = model.detail;
  const unavailable = model.loading || !!model.error || model.noCompany;
  const busy = mutations.remove.isPending || mutations.removeEntry.isPending;
  const availableControls = model.controls;
  const hasFilters = !!(search.trim() || dateFrom || dateTo || pendingOnly);
  const filtersSettled = validPeriod && search.trim() === (appliedFilters.search || '') && dateFrom === (appliedFilters.dateFrom || '') && dateTo === (appliedFilters.dateTo || '') && pendingOnly === !!appliedFilters.pendingOnly;
  const clearFilters = () => {setSearch(''); setDateFrom(''); setDateTo(''); setPendingOnly(false); setAppliedFilters({search: '', dateFrom: '', dateTo: '', pendingOnly: false});};
  const entriesByDay = new Map<string, WeighingEntry[]>();
  if (detail) for (const entry of detail.entries) {
    const entries = entriesByDay.get(entry.weighedAt);
    if (entries) entries.push(entry); else entriesByDay.set(entry.weighedAt, [entry]);
  }
  async function deleteControl() {
    if (!detail || deleting.current) return;
    deleting.current = true;
    try {
      const accepted = await confirm({title: 'Excluir controle de pesagem?', description: `Todas as viagens deste controle de ${detail.control.partnerName} serão excluídas. Esta ação não pode ser desfeita.`, confirmLabel: 'Excluir controle', tone: 'destructive'});
      if (!accepted || !mounted.current) return;
      setActionError(''); await mutations.remove.mutateAsync(id);
      if (mounted.current) {notifications.deleted('O controle e suas viagens foram excluídos.'); navigate('/pesagens');}
    } catch (reason) {if (mounted.current) {const message = (reason as Error).message; setActionError(message); notifications.error(message);}}
    finally {deleting.current = false;}
  }
  async function deleteEntry(entry: WeighingEntry) {
    if (deleting.current) return;
    deleting.current = true;
    try {
      const accepted = await confirm({title: 'Excluir esta viagem?', description: `A viagem de ${dateLabel(entry.weighedAt)}${entry.weighedTime ? ` às ${entry.weighedTime}` : ''}, com caminhão e dois reboques, será removida do comparativo.`, confirmLabel: 'Excluir viagem', tone: 'destructive'});
      if (!accepted || !mounted.current) return;
      setActionError(''); await mutations.removeEntry.mutateAsync({controlId: id, id: entry.id});
      if (mounted.current) notifications.deleted('A viagem foi excluída e o comparativo foi atualizado.');
    } catch (reason) {if (mounted.current) {const message = (reason as Error).message; setActionError(message); notifications.error(message);}}
    finally {deleting.current = false;}
  }
  return <section className="weighing-page">
    {id && <ModuleLink href="/pesagens" className="weighing-back"><ArrowLeft size={15}/>Controles de pesagem</ModuleLink>}
    <div className="weighing-heading"><div><div className="eyebrow">CONTROLE OPERACIONAL</div><h2>{detail ? `AGRISUL × ${detail.control.partnerName}` : 'Pesagem de cana'}</h2><p>{detail ? `Safra ${detail.control.season} · Início em ${dateLabel(detail.control.startDate)}` : 'Lance as fichas de campo e compare a pesagem com cada parceiro.'}</p></div><div className="weighing-heading-actions">{!unavailable && model.canManage && <button className="btn company-primary" onClick={() => detail ? setEntryDialog({}) : setControlDialog(true)}><Plus size={17}/>{detail ? 'Adicionar viagem' : 'Novo controle'}</button>}</div></div>
    <div className="weighing-filters" aria-label="Filtros de pesagem">
      <label className="weighing-filter-search"><span>Buscar</span><div className="weighing-search"><Search size={16}/><input type="search" maxLength={160} aria-label={id ? 'Buscar viagem por frota, placa, ticket ou observações' : 'Buscar controle por parceiro ou safra'} placeholder={id ? 'Frota, placa, ticket ou observações' : 'Parceiro, safra ou observações'} value={search} onChange={event => setSearch(event.target.value)}/></div></label>
      <label className="weighing-filter-date"><span>Data inicial</span><input type="date" max="9998-12-31" value={dateFrom} onChange={event => setDateFrom(event.target.value)}/></label>
      <label className="weighing-filter-date"><span>Data final</span><input type="date" min={dateFrom || undefined} max="9998-12-31" aria-invalid={!validPeriod} aria-describedby={!validPeriod ? 'weighing-period-error' : undefined} value={dateTo} onChange={event => setDateTo(event.target.value)}/></label>
      <button type="button" className="btn weighing-clear-filters" onClick={clearFilters} disabled={!hasFilters}>Limpar filtros</button>
      <div className="weighing-filter-help"><p>{id ? 'Totais, PDF e Excel seguem os filtros aplicados.' : 'O período considera a data de início do controle.'}</p>{id && <label className="weighing-check"><input type="checkbox" checked={pendingOnly} onChange={event => setPendingOnly(event.target.checked)}/>Somente pendentes</label>}</div>
      {!validPeriod && <p id="weighing-period-error" className="form-error" role="alert">A data final deve ser igual ou posterior à data inicial.</p>}
    </div>
    {model.loading ? <div className="weighing-state" role="status"><Loader2 size={25} className="animate-spin"/><p>Carregando pesagens…</p></div> : model.error ? <div className="weighing-state" role="alert"><Scale size={28}/><h3>Não foi possível carregar as pesagens</h3><p>{model.error}</p><button className="btn" onClick={() => void model.reload()}><RefreshCw size={16}/>Tentar novamente</button></div> : model.noCompany ? <div className="weighing-state"><Scale size={30}/><h3>Selecione uma empresa para começar</h3><p>Os controles de pesagem acompanham a empresa selecionada.</p><ModuleLink className="btn company-primary" href="/configuracoes?secao=empresas">Cadastrar empresa</ModuleLink></div> : detail ? <>
      <div className="weighing-control-bar"><span><CalendarDays size={16}/>{detail.control.partnerName}</span><div><button className="btn" disabled={busy || !filtersSettled} onClick={() => setPdfSnapshot(detail)}><FileText size={15}/>Prévia PDF</button><button className="btn" disabled={busy || !filtersSettled} onClick={() => {try {exportWeighingXlsx(detail); notifications.saved('O comparativo foi baixado em Excel.');} catch (reason) {notifications.error((reason as Error).message || 'Não foi possível gerar o Excel.');}}}><Download size={15}/>Baixar Excel</button>{model.canManage && <><button className="btn" disabled={busy} onClick={() => setControlDialog(true)}><Pencil size={15}/>Editar controle</button><button className="btn weighing-danger" disabled={busy} onClick={() => void deleteControl()}><Trash2 size={15}/>Excluir</button></>}</div></div>
      {detail.control.notes && <p className="weighing-control-notes">{detail.control.notes}</p>}
      <WeighingMetrics summary={detail.summary} partner={detail.control.partnerName}/>
      <div className="weighing-comparison-note"><Info size={17}/><p>Todos os pesos estão em <strong>quilogramas (kg)</strong>. Diferença = líquido do parceiro − líquido AGRISUL. Valores positivos indicam peso maior no parceiro. Pesos pendentes não são considerados zero.</p></div>
      <div className="weighing-results-heading"><div><h3>Viagens e comparativo</h3><p>Resultados dos filtros aplicados.</p></div></div>
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {!(detail.totalEntryCount ?? detail.entries.length) ? <div className="weighing-state weighing-empty"><Truck size={35}/><h3>Adicione a primeira viagem</h3><p>Informe a frota, as placas, a tara e o bruto da ficha. O líquido do parceiro pode ser preenchido depois.</p>{model.canManage && <button className="btn company-primary" onClick={() => setEntryDialog({})}><Plus size={16}/>Adicionar viagem</button>}</div> : !entriesByDay.size ? <div className="weighing-state weighing-empty"><Search size={30}/><h3>Nenhuma viagem neste filtro</h3><p>Ajuste a busca, o período ou a seleção de pendentes.</p></div> : <div className="weighing-days">{Array.from(entriesByDay, ([date, entries]) => {
        const daily = detail.daily.find(day => day.date === date);
        return <details key={date} open className="weighing-day"><summary><CalendarDays size={19}/><span><strong>{dateLabel(date)}</strong><small>{daily?.entryCount ?? ''} viagens no dia{daily?.pendingCount ? ` · ${daily.pendingCount} pendentes` : ''}</small></span><span className="weighing-day-total">{weightLabel(daily?.agrisulNetKg)} <small>kg AGRISUL</small></span><ChevronDown size={17}/></summary><div className="weighing-trips">{entries.map(entry => <WeighingTrip key={entry.id} entry={entry} partner={detail.control.partnerName} canManage={model.canManage} busy={busy} onEdit={() => setEntryDialog({entry})} onDelete={() => void deleteEntry(entry)}/>)}</div>{daily && <div className="weighing-day-footer"><strong>Total do dia</strong><span>AGRISUL: <b>{weightLabel(daily.agrisulNetKg)} kg</b></span><span>Parceiro: <b>{weightLabel(daily.partnerNetKg)} kg</b></span><span>Diferença: <b>{weightLabel(daily.differenceKg)}{daily.differenceKg != null ? ' kg' : ''}</b></span></div>}</details>;
      })}</div>}
    </> : !id ? <>
      {!availableControls.length ? <div className="weighing-state weighing-empty"><Scale size={36}/><h3>{hasFilters ? 'Nenhum controle encontrado' : 'Seu comparativo começa aqui'}</h3><p>{hasFilters ? 'Ajuste a busca ou o período para encontrar o controle.' : 'Crie um controle com a data de início e o parceiro. Dentro dele, registre as viagens dos próximos dias.'}</p>{!hasFilters && model.canManage && <button className="btn company-primary" onClick={() => setControlDialog(true)}><Plus size={16}/>Criar primeiro controle</button>}</div> : <div className="weighing-controls">{availableControls.map(control => <ModuleLink key={control.id} href={href(control.id)} className="weighing-control-card"><div className="weighing-card-top"><span className="weighing-card-icon"><Scale size={21}/></span><span>SAFRA {control.season}</span><ArrowRight size={17}/></div><h3>{control.partnerName}</h3><p><CalendarDays size={14}/>Início em {dateLabel(control.startDate)}</p><div className="weighing-card-values"><span><small>Líquido AGRISUL</small><strong>{weightLabel(control.summary.agrisulNetKg)} <em>kg</em></strong></span><span><small>Viagens</small><strong>{control.summary.entryCount}</strong></span></div><div className="weighing-card-bottom"><span className={control.summary.pendingCount ? 'weighing-pending' : 'weighing-complete'}>{control.summary.pendingCount ? `${control.summary.pendingCount} pendentes` : control.summary.entryCount ? 'Comparativo preenchido' : 'Aguardando viagens'}</span><span>Abrir controle <ArrowRight size={13}/></span></div></ModuleLink>)}</div>}
    </> : <div className="weighing-state"><h3>Controle não encontrado</h3><ModuleLink href="/pesagens" className="btn">Voltar aos controles</ModuleLink></div>}
    {pdfSnapshot && <PdfExportDialog snapshot={pdfSnapshot} companyId={pdfSnapshot.control.companyId} title="Comparativo de pesagem de cana" description="Confira as viagens e os totais dos filtros antes de baixar ou imprimir." orientation="landscape" fitPreviewToWidth createPdf={createWeighingPdf} onClose={() => setPdfSnapshot(null)}/>}
    {controlDialog && !unavailable && model.canManage && <WeighingControlDialog control={detail?.control} onClose={() => setControlDialog(false)} onSaved={savedId => {setControlDialog(false); if (!id) navigate(href(savedId));}}/>}
    {entryDialog && detail && !unavailable && model.canManage && <WeighingEntryDialog control={detail.control} entry={entryDialog.entry} lastDate={detail.entries[detail.entries.length - 1]?.weighedAt ?? detail.control.startDate} onClose={() => setEntryDialog(null)}/>}
  </section>;
}

function WeighingTrip({entry, partner, canManage, busy, onEdit, onDelete}: {entry: WeighingEntry; partner: string; canManage: boolean; busy: boolean; onEdit: () => void; onDelete: () => void}) {
  const pending = entry.differenceKg == null;
  return <article className="weighing-trip"><header><div><Truck size={17}/><strong>{entry.components[0]?.fleetNumber ? `Frota ${entry.components[0].fleetNumber}` : entry.components[0]?.plate || 'Viagem'}</strong>{entry.weighedTime && <span>{entry.weighedTime.slice(0, 5)}</span>}{entry.ticket && <small>Ticket: {entry.ticket}</small>}<span className={pending ? 'weighing-pending' : 'weighing-complete'}>{pending ? 'Dados pendentes' : 'Completa'}</span></div>{canManage && <div className="weighing-row-actions"><button type="button" aria-label={`Editar viagem ${entry.components[0]?.fleetNumber || ''} de ${entry.weighedAt}`} disabled={busy} onClick={onEdit}><Pencil size={15}/><span>Editar</span></button><button type="button" aria-label={`Excluir viagem ${entry.components[0]?.fleetNumber || ''} de ${entry.weighedAt}`} disabled={busy} onClick={onDelete}><Trash2 size={15}/></button></div>}</header>
    <div className="weighing-table-wrap"><table className="weighing-table"><thead><tr><th scope="col">Veículo</th><th scope="col">Frota / Placa</th><th scope="col" className="numeric">Tara AGRISUL</th><th scope="col" className="numeric">Bruto AGRISUL</th><th scope="col" className="numeric">Líquido AGRISUL</th><th scope="col" className="numeric">Líquido {partner}</th><th scope="col" className="numeric">Diferença (kg)</th></tr></thead><tbody>{entry.components.map((component, index) => <tr key={index}><td>{component.kind === 'truck' ? 'Caminhão' : `Reboque ${index}`}</td><td><strong>{component.fleetNumber || '—'}</strong><small>{component.plate || 'Placa não informada'}</small></td><td className="numeric">{weightLabel(component.tareKg)}</td><td className="numeric">{weightLabel(component.grossKg)}</td><td className="numeric weighing-net">{weightLabel(component.netKg)}</td><td className="numeric">{weightLabel(component.partnerNetKg)}</td><td className="numeric">{weightLabel(component.differenceKg)}</td></tr>)}</tbody><tfoot><tr><th colSpan={2} scope="row">Subtotal da viagem <small>(kg)</small></th><td className="numeric"><strong>{weightLabel(entry.tareKg)}</strong></td><td className="numeric"><strong>{weightLabel(entry.grossKg)}</strong></td><td className="numeric"><strong>{weightLabel(entry.agrisulNetKg)}</strong></td><td className="numeric"><strong>{weightLabel(entry.partnerNetKg)}</strong>{!entry.partnerComplete && entry.partnerNetKg != null && <small>Parcial</small>}</td><td className="numeric"><strong>{weightLabel(entry.differenceKg)}</strong></td></tr></tfoot></table></div>
    <footer><span>{entry.trailerGrossMode === 'combined' ? `Bruto conjunto dos reboques: ${weightLabel(entry.combinedTrailerGrossKg)} kg · rateio igual` : 'Reboques pesados individualmente'}</span><span>Diferença <strong>{weightLabel(entry.differenceKg)}{entry.differenceKg != null ? ' kg' : ''}</strong>{entry.differencePercent != null && <small>({percentLabel(entry.differencePercent)})</small>}</span></footer>
    {entry.notes && <p className="weighing-trip-notes">{entry.notes}</p>}
  </article>;
}
