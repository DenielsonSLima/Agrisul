'use client';
import {useState} from 'react';
import {Coins, FileDown, FileText, MapPinned, Truck} from 'lucide-react';
import {useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {BillingQueryState} from '@/shared/components/BillingQueryState';
import {currentMonth} from '@/shared/utils/presentation';
import {reportCatalog, reportMetricColumns} from '../catalog';
import {useReports} from '../hooks/useReports';
import {ReportFilters} from '../forms/ReportFilters';
import {monthRange, reportCell, reportPeriod} from '../reporting/reportPresentation';
import {ReportTable} from './ReportTable';
import {ReportExportDialog} from './ReportExportDialog';
import type {LoadReportFilters, ReportKind, ReportSnapshot} from '../types';
import '../styles.css';
const icons={contracts:FileText,loads:Truck,financial:Coins,farms:MapPinned};
const validDay=(value:string)=>{if(!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)||value<'1900-01-01'||value>'9999-12-31')return false;const [year,month,day]=value.split('-').map(Number),date=new Date(year,month-1,day);return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day;};
const validId=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function RelatoriosPage() {
  const {searchParams,navigate}=useModuleNavigation();
  const selected=reportCatalog.find(item=>item.id===searchParams.get('tipo'))??reportCatalog[0];
  const requested=searchParams.get('mes')??'';
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)&&requested>='1900-01'&&requested<='9998-12'?requested:currentMonth();
  const defaults=monthRange(month),requestedFrom=searchParams.get('inicio')??'',requestedTo=searchParams.get('fim')??'';
  const parsedFrom=validDay(requestedFrom)?requestedFrom:'',parsedTo=validDay(requestedTo)?requestedTo:'';
  const loadFilters:LoadReportFilters={search:(searchParams.get('busca')??'').slice(0,200),from:parsedFrom||parsedTo||defaults.from,to:parsedTo||parsedFrom||defaults.to,farmId:validId(searchParams.get('fazenda')??'')?searchParams.get('fazenda')!:'',plotId:validId(searchParams.get('talhao')??'')?searchParams.get('talhao')!:''};
  const model=useReports(selected.id,{month,loadFilters});
  const [snapshot,setSnapshot]=useState<ReportSnapshot|null>(null);
  const select=(kind:ReportKind,period=month)=>kind==='loads'?navigate(`/relatorios?tipo=loads&inicio=${monthRange(period).from}&fim=${monthRange(period).to}`):navigate(`/relatorios?tipo=${kind}&mes=${period}`);
  const applyLoadFilters=(filters:LoadReportFilters)=>{const params=new URLSearchParams({tipo:'loads',inicio:filters.from,fim:filters.to});if(filters.search)params.set('busca',filters.search);if(filters.farmId)params.set('fazenda',filters.farmId);if(filters.plotId)params.set('talhao',filters.plotId);navigate(`/relatorios?${params}`);};
  const appliedFilters=model.data?.kind==='loads'?model.data.filters:loadFilters;
  return <section className="reports-page"><div className="companies-heading"><div><div className="eyebrow">DOCUMENTOS E CONSULTAS</div><h2>Relatórios</h2><p>Escolha o relatório, confira os dados e baixe o documento.</p></div></div>
    <div className="reports-catalog" aria-label="Tipos de relatório">{reportCatalog.map(item=>{const Icon=icons[item.id];return <button key={item.id} aria-pressed={item.id===selected.id} onClick={()=>select(item.id)}><Icon size={23} strokeWidth={1.6}/><strong>{item.title}</strong><span>{item.description}</span></button>;})}</div>
    <div className="reports-workspace"><div className="reports-heading"><div><h3>{selected.title}</h3><p>{reportPeriod(selected.id,month,selected.id==='loads'?appliedFilters:undefined)}</p></div><button className="btn company-primary" disabled={!model.data||model.loading||model.isFetching||!!model.errorMessage||model.noCompany} onClick={()=>{if(model.data)setSnapshot({data:structuredClone(model.data),month,companyId:model.companyId});}}><FileDown size={16}/>Exportar PDF</button></div>
      <ReportFilters key={selected.id==='loads'?`${loadFilters.search}|${loadFilters.from}|${loadFilters.to}|${loadFilters.farmId}|${loadFilters.plotId}`:selected.id} kind={selected.id} month={month} onMonth={value=>select(selected.id,value)} filters={loadFilters} origins={model.data?.kind==='loads'?model.data.origins:[]} onFilters={applyLoadFilters}/>
      <BillingQueryState {...model}/>
      {model.data&&!model.errorMessage&&<div aria-busy={model.isFetching}><dl className="reports-metrics">{reportMetricColumns[selected.id].map(metric=><div key={metric.key}><dt>{metric.label}</dt><dd>{reportCell(model.data!.totals[metric.key],metric)}</dd></div>)}</dl>
        {model.data.totals.billingPending===true&&<p className="reports-note">Há contratos com ATR ou cotação pendente. Os valores incompletos aparecem como “A apurar”.</p>}
        <ReportTable data={model.data}/><p className="reports-record-count">{model.data.total} registros{model.isFetching?' · Atualizando…':''}</p>
      </div>}
    </div>{snapshot&&<ReportExportDialog snapshot={snapshot} onClose={()=>setSnapshot(null)}/>}
  </section>;
}
