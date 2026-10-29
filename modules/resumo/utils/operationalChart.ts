import type {ExecutiveMonthlyOperation,ExecutiveOperationalPeriod,ExecutiveOperationalTotals} from '../types';
import type {FinancialGrouping} from '../financialGrouping';

export type OperationalChartRow=ExecutiveOperationalTotals&{key:string;endDate?:string;granularity:FinancialGrouping};
/** Select the server aggregation verbatim; never fall back to monthly data for another grouping. */
export function operationalChartRows(months:readonly ExecutiveMonthlyOperation[],days:readonly ExecutiveOperationalPeriod[]|undefined,grouping:FinancialGrouping,periods?:readonly ExecutiveOperationalPeriod[]):OperationalChartRow[]{
 return (grouping==='month'?months.map(row=>({...row,key:row.month,granularity:grouping})):(grouping==='day'?days??[]:periods??[]).map(row=>({...row,key:row.date,granularity:grouping})))
  .filter(row=>row.loadCount>0);
}
