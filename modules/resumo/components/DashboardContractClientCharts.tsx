'use client';

import {decimalLabel} from '@/shared/utils/presentation';
import type {ExecutiveSummaryData} from '../types';

type Client=NonNullable<ExecutiveSummaryData['contractComparison']>['clients'][number];

/** Draw the RPC's official figures; normalized widths are chart geometry only. */
export function DashboardContractClientCharts({client}:{client:Client}){
 const rows=client.types.filter(row=>row.code!=='unknown'||row.contractCount>0||row.loadCount>0);
 const plotValues=rows.map(row=>Math.max(0,Number(row.loadedVolume)||0));
 const maximum=Math.max(0,...plotValues);
 return <article className="dashboard-contract-client-card dashboard-contract-client-chart" data-comparison-client-id={client.id}>
  <h4>{client.name}</h4>
  <div className="dashboard-contract-client-overall" data-comparison-type="overall">
   <span>Geral</span>
   <div className="dashboard-contract-client-total"><strong data-comparison-value="volume" title={decimalLabel(client.overall.loadedVolume)}>{decimalLabel(client.overall.loadedVolume)}</strong><small>t</small></div>
   <div className="dashboard-contract-client-total-atr"><span>ATR médio</span><strong data-comparison-value="atr" title={decimalLabel(client.overall.averageAtr)}>{decimalLabel(client.overall.averageAtr)}</strong>{client.overall.averageAtr!==''&&<small>kg/t</small>}</div>
  </div>
  <div className="dashboard-contract-client-bars" role="list" aria-label="Toneladas e ATR por modalidade">
   {rows.map((row,index)=><div className="dashboard-contract-client-bar" role="listitem" key={row.code} data-comparison-type={row.code} data-client-chart-tone={row.code==='1'?'manual':row.code==='2'?'mechanized':'unknown'}>
    <div className="dashboard-contract-client-bar-heading"><span>{row.label}</span><div><strong data-comparison-value="volume" title={decimalLabel(row.loadedVolume)}>{decimalLabel(row.loadedVolume)}</strong> <small>t</small></div></div>
    <div className="dashboard-contract-client-bar-track" aria-hidden="true"><i style={{width:`${maximum>0?plotValues[index]/maximum*100:0}%`}}/></div>
    <div className="dashboard-contract-client-bar-atr"><span>ATR</span><strong data-comparison-value="atr" title={decimalLabel(row.averageAtr)}>{decimalLabel(row.averageAtr)}</strong>{row.averageAtr!==''&&<small>kg/t</small>}</div>
   </div>)}
  </div>
  {maximum===0&&<p className="dashboard-contract-client-zero">Sem entregas no período</p>}
  <footer>{client.overall.contractCount} contrato(s) · {client.overall.loadCount} carregamento(s)</footer>
 </article>;
}
