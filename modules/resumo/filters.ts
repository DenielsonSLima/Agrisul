import {localDay} from '@/shared/utils/presentation';
import type {SummaryFilters} from './types';

// Calendar navigation only. All business metrics come from the RPC.
export function shiftDay(day:string,amount:number){
 const date=new Date(`${day}T12:00:00`);date.setDate(date.getDate()+amount);return localDay(date);
}
export function defaultRange():SummaryFilters{
 const to=localDay();return {from:shiftDay(to,-364),to,contractId:'',status:''};
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
