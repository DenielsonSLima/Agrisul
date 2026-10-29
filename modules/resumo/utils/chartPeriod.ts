import {dateLabel,monthLabel} from '@/shared/utils/presentation';
import type {FinancialGrouping} from '../financialGrouping';

type ChartPeriod={key:string;endDate?:string;granularity:FinancialGrouping};
const shortDay=(value:string)=>value.slice(8,10)+'/'+value.slice(5,7);
export const chartPeriodLabel=(row:ChartPeriod)=>row.granularity==='month'?monthLabel(row.key).slice(0,3)+'/'+row.key.slice(2,4):row.endDate&&row.endDate!==row.key?shortDay(row.key)+'–'+shortDay(row.endDate):shortDay(row.key);
export const fullChartPeriod=(row:ChartPeriod)=>row.granularity==='month'?monthLabel(row.key):row.endDate&&row.endDate!==row.key?dateLabel(row.key)+' a '+dateLabel(row.endDate):dateLabel(row.key);
