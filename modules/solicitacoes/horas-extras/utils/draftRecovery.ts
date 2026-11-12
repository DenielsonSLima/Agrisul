import type {OvertimeDaily,OvertimeDailyEntry,OvertimeInput,OvertimeReport} from '../types';

// Comparisons and draft reconciliation only; durations and totals remain server-owned.
const serialize=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(a:unknown,b:unknown)=>serialize(a)===serialize(b);
const text=(value:string|undefined)=>(value??'').trim();
const clock=(value:string)=>value.length===5?value+':00':value;
function duration(value:string){
 if(!value)return '';
 const [hours,minutes='00',seconds='00']=value.split(':');
 return [hours.replace(/^0+(?=\d)/,'').padStart(2,'0'),minutes,seconds].join(':');
}
function choose<T>(base:T,local:T,remote:T,label:string,conflicts:string[]):T{
 if(same(local,base))return remote;
 if(same(remote,base)||same(remote,local))return local;
 conflicts.push(label);return local;
}
export function reportDraft(report:OvertimeReport):OvertimeInput{
 return {companyId:report.companyId,id:report.id,dateFrom:report.dateFrom,dateTo:report.dateTo,referenceMonth:report.referenceMonth,sector:report.sector,notes:report.notes,
  rows:report.rows.map(({employeeId,hours50,hours100})=>({employeeId,hours50,hours100}))};
}
function reportMatchesDraft(remote:OvertimeReport,input:OvertimeInput){
 const normalized=(value:OvertimeInput)=>({id:value.id,companyId:value.companyId,dateFrom:value.dateFrom,dateTo:value.dateTo,sector:text(value.sector),notes:text(value.notes),
  rows:value.rows.map(row=>({employeeId:row.employeeId,hours50:duration(row.hours50||'00:00:00'),hours100:duration(row.hours100||'00:00:00')})).sort((a,b)=>a.employeeId.localeCompare(b.employeeId))});
 return same(normalized(reportDraft(remote)),normalized(input));
}
export function recoverReportDraft(base:OvertimeReport,local:OvertimeInput,remote:OvertimeReport,submitted?:OvertimeInput){
 if(base.id!==remote.id||local.id!==remote.id||base.companyId!==remote.companyId||local.companyId!==remote.companyId)throw new Error('O relatório foi alterado. Reabra a tela.');
 if(submitted&&reportMatchesDraft(remote,submitted))base=remote;
 const conflicts:string[]=[],input=reportDraft(remote);
 for(const [key,label] of [['dateFrom','Data inicial'],['dateTo','Data final'],['sector','Setor'],['notes','Observação']] as const){
  input[key]=choose(text(base[key]),text(local[key]),text(remote[key]),label,conflicts);
 }
 const localIds=new Set(local.rows.map(row=>row.employeeId)),baseIds=new Set(base.rows.map(row=>row.employeeId));
 input.rows=remote.rows.filter(row=>{
  if(!baseIds.has(row.employeeId)||localIds.has(row.employeeId))return true;
  if(!same(base.rows.find(item=>item.employeeId===row.employeeId),row))conflicts.push('Lançamentos de '+row.employeeName);
  return false;
 }).map(({employeeId,hours50,hours100})=>({employeeId,hours50,hours100}));
 for(const row of local.rows){
  if(!baseIds.has(row.employeeId)&&!input.rows.some(item=>item.employeeId===row.employeeId))input.rows.push(row);
 }
 if(remote.rows.some(row=>input.rows.some(item=>item.employeeId===row.employeeId)&&row.daily?.entries.some(entry=>entry.date<input.dateFrom||entry.date>input.dateTo)))conflicts.push('Período com lançamentos diários');
 return {input,conflicts,alreadySaved:same(input,reportDraft(remote))};
}
export type DailyDraft=Pick<OvertimeDaily,'activity'|'sector'|'entries'|'adjustment'>;
function comparableDay(entry:OvertimeDailyEntry){
 return {date:entry.date,startTime:clock(entry.startTime),breakStart:clock(entry.breakStart),breakEnd:clock(entry.breakEnd),endTime:clock(entry.endTime),
  breakDuration:entry.breakStart||entry.breakEnd?'':duration(entry.breakDuration),rate:entry.rate,reason:text(entry.reason),approval:text(entry.approval)};
}
export function dailyDraft(daily:DailyDraft):DailyDraft{
 return {activity:text(daily.activity),sector:text(daily.sector),entries:daily.entries.map(comparableDay).sort((a,b)=>a.date.localeCompare(b.date)),
  adjustment:daily.adjustment?{hours50:duration(daily.adjustment.hours50),hours100:duration(daily.adjustment.hours100),reason:text(daily.adjustment.reason)}:null};
}
export function recoverDailyDraft(base:DailyDraft,local:DailyDraft,remote:DailyDraft,report:OvertimeReport,submitted?:DailyDraft){
 if(submitted&&same(dailyDraft(submitted),dailyDraft(remote)))base=remote;
 const before=dailyDraft(base),draft=dailyDraft(local),current=dailyDraft(remote),conflicts:string[]=[];
 const input:DailyDraft={activity:choose(before.activity,draft.activity,current.activity,'Atividade',conflicts),sector:choose(before.sector,draft.sector,current.sector,'Setor',conflicts),
  adjustment:choose(before.adjustment,draft.adjustment,current.adjustment,'Ajuste dos totais',conflicts),entries:[]};
 const dates=new Set([...before.entries,...draft.entries,...current.entries].map(entry=>entry.date));
 for(const date of [...dates].sort()){
  const entry=choose(before.entries.find(item=>item.date===date),draft.entries.find(item=>item.date===date),current.entries.find(item=>item.date===date),'Dia '+date,conflicts);
  if(entry)input.entries.push(entry);
 }
 if(input.entries.some(entry=>entry.date<report.dateFrom||entry.date>report.dateTo))conflicts.push('Período do relatório');
 return {input,conflicts,alreadySaved:same(input,current)};
}
export function blockingOvertimeRead(query:{error:string;status:number;data:unknown}){
 return !!query.error&&(!query.data||query.status<500);
}
