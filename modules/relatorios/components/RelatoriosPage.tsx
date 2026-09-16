'use client';
import {useState} from 'react';
import {Coins, FileDown, FileText, MapPinned, Truck} from 'lucide-react';
import {useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {BillingQueryState} from '@/shared/components/BillingQueryState';
import {currentMonth} from '@/shared/utils/presentation';
import {reportCatalog, reportMetricColumns} from '../catalog';
import {useReports} from '../hooks/useReports';
import {ReportFilters} from '../forms/ReportFilters';
import {reportCell, reportPeriod} from '../reporting/reportPresentation';
import {ReportTable} from './ReportTable';
import {ReportExportDialog} from './ReportExportDialog';
import type {ReportKind, ReportSnapshot} from '../types';
import '../styles.css';
const icons={contracts:FileText,loads:Truck,financial:Coins,farms:MapPinned};

export function RelatoriosPage() {
  const {searchParams,navigate}=useModuleNavigation();
  const selected=reportCatalog.find(item=>item.id===searchParams.get('tipo'))??reportCatalog[0];
  const requested=searchParams.get('mes')??'';
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)&&requested>='1900-01'&&requested<='9998-12'?requested:currentMonth();
  const model=useReports(selected.id,month);
  const [snapshot,setSnapshot]=useState<ReportSnapshot|null>(null);
  const select=(kind:ReportKind,period=month)=>navigate(`/relatorios?tipo=${kind}&mes=${period}`);
  return <section className="reports-page"><div className="companies-heading"><div><div className="eyebrow">DOCUMENTOS E CONSULTAS</div><h2>Relatórios</h2><p>Escolha o relatório, confira os dados e baixe o documento.</p></div></div>
    <div className="reports-catalog" aria-label="Tipos de relatório">{reportCatalog.map(item=>{const Icon=icons[item.id];return <button key={item.id} aria-pressed={item.id===selected.id} onClick={()=>select(item.id)}><Icon size={23} strokeWidth={1.6}/><strong>{item.title}</strong><span>{item.description}</span></button>;})}</div>
    <div className="reports-workspace"><div className="reports-heading"><div><h3>{selected.title}</h3><p>{reportPeriod(selected.id,month)}</p></div><button className="btn company-primary" disabled={!model.data||model.loading||model.isFetching||!!model.errorMessage||model.noCompany} onClick={()=>{if(model.data)setSnapshot({data:structuredClone(model.data),month,companyId:model.companyId});}}><FileDown size={16}/>Exportar PDF</button></div>
      <ReportFilters kind={selected.id} month={month} onMonth={value=>select(selected.id,value)}/>
      <BillingQueryState {...model}/>
      {model.data&&!model.errorMessage&&<div aria-busy={model.isFetching}><dl className="reports-metrics">{reportMetricColumns[selected.id].map(metric=><div key={metric.key}><dt>{metric.label}</dt><dd>{reportCell(model.data!.totals[metric.key],metric)}</dd></div>)}</dl>
        {model.data.totals.billingPending===true&&<p className="reports-note">Há contratos com ATR ou cotação pendente. Os valores incompletos aparecem como “A apurar”.</p>}
        <ReportTable data={model.data}/><p className="reports-record-count">{model.data.total} registros{model.isFetching?' · Atualizando…':''}</p>
      </div>}
    </div>{snapshot&&<ReportExportDialog snapshot={snapshot} onClose={()=>setSnapshot(null)}/>}
  </section>;
}
