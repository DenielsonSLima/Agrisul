import type {OvertimeDailyEntry} from '../types';

// Calendar rows and formatting only. Durations and totals come from the RPC.
export function dailyOvertimeCalendar(dateFrom:string,dateTo:string,entries:OvertimeDailyEntry[]){
 const byDate=new Map<string,OvertimeDailyEntry[]>();
 for(const entry of entries){
  const periods=byDate.get(entry.date)??[];periods.push(entry);byDate.set(entry.date,periods);
 }
 const start=new Date(dateFrom+'T12:00:00Z'),end=new Date(dateTo+'T12:00:00Z');
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>end)return [];
 const result:{date:string;entry:OvertimeDailyEntry|undefined;rowKey:string}[]=[];
 for(const cursor=new Date(start);cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1)){
  const date=cursor.toISOString().slice(0,10),periods=byDate.get(date)??[];
  if(!periods.length)result.push({date,entry:undefined,rowKey:date+':blank'});
  else periods.forEach((entry,index)=>result.push({date,entry,rowKey:date+':'+(entry.id??index)}));
 }
 return result;
}

export function dailyClockLabel(value:string|null|undefined){
 if(!value)return '';
 return value.length===8&&value.endsWith(':00')?value.slice(0,5):value;
}

export function dailyHoursLabel(value:string|null|undefined){
 return !value||value==='00:00:00'?'':value;
}

export function dailyReasonLabel(entry:OvertimeDailyEntry|undefined){
 if(!entry)return '';
 const interval=!entry.breakStart&&!entry.breakEnd&&entry.breakDuration&&entry.breakDuration!=='00:00:00'
  ?'Intervalo descontado: '+dailyClockLabel(entry.breakDuration):'';
 return [entry.reason,interval].filter(Boolean).join('\n');
}
