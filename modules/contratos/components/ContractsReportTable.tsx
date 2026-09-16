import type {CSSProperties} from 'react';
import type {BillingContract,ContractListSummary} from '../types';
import {contractSummaryItems} from '../utils/contractSummaryPresentation';
import {contractsReportColors,contractsReportColumns,contractsReportRow,type ContractsReportTone} from '../reporting/contractsReportPresentation';

function metricStyle(tone:ContractsReportTone):CSSProperties{
 const colors=contractsReportColors[tone];
 return {'--metric-background':colors.background,'--metric-accent':colors.accent,'--metric-text':colors.text} as CSSProperties;
}

export function ContractsReportSummary({summary}:{summary:ContractListSummary}){
 return <dl className="contract-report-summary">{contractSummaryItems(summary).map(item=><div key={item.key} style={metricStyle(item.key)}><dt>{item.label}</dt><dd>{item.value}</dd><small>{item.hint}</small></div>)}</dl>;
}

export function ContractsReportTable({contracts}:{contracts:BillingContract[]}){
 return <table className="contracts-list-report-table" aria-label="Quantidades e financeiro por contrato">
  <colgroup>{contractsReportColumns.map(column=><col key={column.key} style={{width:column.width+'%'}}/>)}</colgroup>
  <thead><tr>{contractsReportColumns.map(column=><th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
  {contracts.map(contract=>{
   const row=contractsReportRow(contract);
   return <tbody key={contract.id} className="contracts-report-group" aria-label={`Contrato ${contract.contractNumber||contract.title}`}>
    <tr className="contracts-report-quantities">
     <th scope="rowgroup" rowSpan={2} className="contracts-report-client"><strong>{row.client}</strong><span>CNPJ: {row.cnpj}</span></th>
     {row.operational.map(cell=><td key={cell.key} data-metric={cell.key} style={metricStyle(cell.tone)}><strong>{cell.value}</strong>{cell.detail&&<small>{cell.detail}</small>}</td>)}
    </tr>
    <tr className="contracts-report-financial">{row.financial.map(cell=><td key={cell.key} data-metric={cell.key} style={metricStyle(cell.tone)}><dl><dt>{cell.label}</dt><dd>{cell.value}</dd></dl></td>)}</tr>
   </tbody>;
  })}
 </table>;
}
