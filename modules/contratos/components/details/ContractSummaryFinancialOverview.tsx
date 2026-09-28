import {Banknote,CalendarDays,CircleDollarSign,Scissors} from 'lucide-react';
import type {BillingContract} from '../../types';
import {useContractLoads} from '../../hooks/useContractLoads';
import {contractSummaryDetails,summaryReceivedNote,type SummaryTable} from '../../utils/contractSummaryDetails';
import {formatAtrCriterion} from '../../utils/contractFormat';
import {contractMonthlyDateFilters,contractMonthlyPeriodError,filterContractMonths,type ContractMonthlyPeriod} from '../../utils/contractMonthlyPeriod';
import {ContractDailyLoadsChart} from './ContractDailyLoadsChart';
import {ContractMonthlyBalancesTable} from './ContractMonthlyBalancesTable';
import {ContractMonthlyDeliveriesTable} from './ContractMonthlyDeliveriesTable';
import {ContractMonthlyCharts} from './ContractMonthlyCharts';
import type {ContractDailyLoadPeriod} from '../../utils/contractDailyLoadsPresentation';
import '../../summary-details.css';

export function ContractSummaryFinancialOverview({contract,monthlyPeriod,onMonthlyPeriod,dailyPeriod,onDailyPeriod}:{contract:BillingContract;monthlyPeriod:ContractMonthlyPeriod;onMonthlyPeriod:(period:ContractMonthlyPeriod)=>void;dailyPeriod:ContractDailyLoadPeriod;onDailyPeriod:(period:ContractDailyLoadPeriod)=>void}){
 const summary=contractSummaryDetails(contract);
 const periodError=contractMonthlyPeriodError(monthlyPeriod),dateFilters=contractMonthlyDateFilters(monthlyPeriod);
 const monthlyLoads=useContractLoads(contract.id,{search:'',...dateFilters,groupBy:'month'},!periodError);
 const filteredChartMonths=filterContractMonths(summary.chartMonths,monthlyPeriod);
 const financialItems=summary.financialItems.filter(item=>item.key!=='received'&&item.key!=='pending'&&item.key!=='credit');
 return <>
  <section className="contract-summary-section contract-summary-financial-overview" aria-label="Resumo financeiro de todo o contrato">
   <div className="contract-summary-section-heading"><span className="contract-summary-icon"><CircleDollarSign size={18}/></span><div><small>Visão financeira · todo o contrato</small><h3>Da entrega ao recebimento</h3></div></div>
   <div className="contract-summary-money-scroll" role="region" aria-label="Indicadores financeiros do contrato" tabIndex={0}><dl className="contract-summary-money-grid">{financialItems.map(item=><div key={item.key} className={'summary-money-'+item.key}><dt>{item.label}</dt><dd>{item.value}</dd><small>{item.hint}</small></div>)}</dl></div>
   <p className="contract-summary-detail-note">{summaryReceivedNote}</p>
   {summary.notice&&<p className="contract-summary-detail-notice" role="status">{summary.notice}</p>}
  </section>
  <ContractDailyLoadsChart contractId={contract.id} period={dailyPeriod} onPeriod={onDailyPeriod}/>
  <section className="contract-summary-section contract-monthly-panel">
   <div className="contract-summary-section-heading"><span className="contract-summary-icon"><CalendarDays size={18}/></span><div><small>Resumo mensal</small><h3>Entregas, faturamento e entradas</h3></div><span className="contract-atr-criterion">ATR {formatAtrCriterion(contract.atrPriceType,contract.atrPeriodType)}</span></div>
   <ContractMonthlyCharts months={filteredChartMonths} period={monthlyPeriod} onPeriod={onMonthlyPeriod} error={periodError}/>
   {summary.months.length?<>
    <ContractMonthlyDeliveriesTable contract={contract} period={monthlyPeriod} data={monthlyLoads.data} loading={monthlyLoads.loading} error={periodError||monthlyLoads.error} onRetry={periodError?undefined:monthlyLoads.reload}/>
    <ContractMonthlyBalancesTable contract={contract} period={monthlyPeriod}/>
   </>:<div className="contract-monthly-empty"><Banknote size={26}/><h4>Nenhuma movimentação lançada</h4><p>Carregamentos, adiantamentos, recebimentos e acordos aparecerão neste resumo.</p></div>}
  </section>
  <div className="contract-summary-ledgers">
   {summary.tables.slice(2).map((model,index)=><details className="contract-summary-section" key={model.title}><summary>{index===0?<Banknote size={18}/>:<Scissors size={18}/>}<span>{model.title}</span><small>{model.rows.length} {index===0?'lançamentos':'acordos'}</small></summary><SummaryDetailTable model={model}/></details>)}
  </div>
 </>;
}

function SummaryDetailTable({model}:{model:SummaryTable}){
 return <section className="contract-summary-detail-table"><h4>{model.title}</h4><p>{model.description}</p>{model.rows.length?<div className="contract-monthly-table-wrap" tabIndex={0} role="region" aria-label={model.title}><table className="contract-monthly-table"><thead><tr>{model.columns.map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{model.rows.map((row,index)=><tr key={index}>{row.map((cell,column)=><td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>:<p className="contract-summary-detail-empty">{model.empty}</p>}</section>;
}
