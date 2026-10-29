import {localDay} from '@/shared/utils/presentation';
import type {SummaryFilters} from './types';
import {DASHBOARD_ROLLING_PERIODS,DEFAULT_DASHBOARD_PERIOD,type DashboardDefaultPeriod} from './defaultPeriod';

// Calendar navigation only. All business metrics come from the RPC.
export function shiftDay(day:string,amount:number){
 const date=new Date(`${day}T12:00:00`);date.setDate(date.getDate()+amount);return localDay(date);
}
export function defaultRange(period:DashboardDefaultPeriod=DEFAULT_DASHBOARD_PERIOD,today=localDay()):SummaryFilters{
 let to=today,from:string;
 const year=Number(today.slice(0,4)),month=Number(today.slice(5,7));
 const monthStart=(offset:number)=>localDay(new Date(year,month-1+offset,1,12));
 switch(period){
  case 'month':from=monthStart(0);break;
  case 'previous-month':from=monthStart(-1);to=shiftDay(monthStart(0),-1);break;
  case 'last-3-months':from=monthStart(-2);break;
  case 'last-6-months':from=monthStart(-5);break;
  case 'last-12-months':from=monthStart(-11);break;
  case 'year':from=`${year}-01-01`;break;
  case 'previous-year':from=`${year-1}-01-01`;to=`${year-1}-12-31`;break;
  default:from=shiftDay(to,1-(DASHBOARD_ROLLING_PERIODS.find(item=>item.id===period)?.days??365));
 }
 return {from,to,contractId:'',status:''};
}
export function rangeDays({from,to}:{from:string;to:string}){
 return Math.round((new Date(`${to}T12:00:00`).getTime()-new Date(`${from}T12:00:00`).getTime())/86400000)+1;
}
export function validRange(range:{from:string;to:string}){
 const days=rangeDays(range);
 return /^\d{4}-\d{2}-\d{2}$/.test(range.from)&&/^\d{4}-\d{2}-\d{2}$/.test(range.to)&&Number.isFinite(days)&&shiftDay(range.from,0)===range.from&&shiftDay(range.to,0)===range.to&&days>=1&&days<=1827&&range.from>='1900-01-01'&&range.to<='9999-12-31';
}
export function monthRange(month:string,range:SummaryFilters):SummaryFilters|null{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return null;
 const end=new Date(`${month}-01T12:00:00`);end.setMonth(end.getMonth()+1,0);
 const from=month+'-01'>range.from?month+'-01':range.from;
 const to=localDay(end)<range.to?localDay(end):range.to;
 return from<=to?{...range,from,to}:null;
}
