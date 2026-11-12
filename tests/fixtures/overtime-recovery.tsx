import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {FeedbackProvider} from '../../shared/feedback';
import {ModuleNavigationProvider} from '../../shared/navigation/ModuleNavigation';
import {OvertimePage} from '../../modules/solicitacoes/horas-extras/components/OvertimePage';
import type {OvertimeDaily,OvertimeDailyEntry,OvertimeEmployee,OvertimeReport,OvertimeRow} from '../../modules/solicitacoes/horas-extras/types';

// Only this deterministic in-memory transport is substituted. The page, RPC
// wrapper, session guard, TanStack mutations, recovery and confirmation UI are real.
const clone=<T,>(value:T):T=>structuredClone(value);
const employees:OvertimeEmployee[]=[
 {id:'employee-one',fullName:'ANA TESTE',registrationNumber:'001',jobTitle:'Operadora'},
 {id:'employee-two',fullName:'BRUNO TESTE',registrationNumber:'002',jobTitle:'Motorista'},
 {id:'employee-three',fullName:'CARLA TESTE',registrationNumber:'003',jobTitle:'Operadora'},
];
const hours=(seconds:number)=>`${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
const seconds=(value:string)=>{const [h=0,m=0,s=0]=value.split(':').map(Number);return h*3600+m*60+s;};
const clock=(value:string)=>value.length===5?value+':00':value;
function daily(employeeId:string):OvertimeDaily{return {employeeId,activity:'Operação',sector:'Agrícola',entries:[],adjustment:null,calculated50:'00:00:00',calculated100:'00:00:00',total50:'00:00:00',total100:'00:00:00',totalHours:'00:00:00',entryCount:0,hasDailyEntries:true,legacyHours50:'00:00:00',legacyHours100:'00:00:00'};}
function initialReport(actor:string):OvertimeReport{
 const rows:OvertimeRow[]=employees.slice(0,2).map(employee=>({employeeId:employee.id,employeeName:employee.fullName,registrationNumber:employee.registrationNumber,jobTitle:employee.jobTitle,hours50:'00:00:00',hours100:'00:00:00',source:'daily',daily:daily(employee.id)}));
 const report:OvertimeReport={id:'report-one',companyId:'company-one',dateFrom:'2026-10-26',dateTo:'2026-10-28',referenceMonth:'2026-10',sector:'Agrícola',notes:actor==='owner-one'?'Observação original':'Observação da outra conta',employeeCount:2,total50:'00:00:00',total100:'00:00:00',createdAt:'0',updatedAt:'0',status:'open',finishedAt:null,canFinish:false,rows};
 rows[0].daily!.entries=[entry('2026-10-26',{reason:'Motivo original'})];recalculate(report);return report;
}
function entry(date:string,patch:Partial<OvertimeDailyEntry>={}):OvertimeDailyEntry{return {id:crypto.randomUUID(),date,startTime:'08:00:00',breakStart:'',breakEnd:'',breakDuration:'00:00:00',endTime:'09:00:00',rate:'50',reason:'Motivo remoto',approval:'',...patch};}
function recalculate(report:OvertimeReport){
 for(const row of report.rows){
  if(!row.daily)continue;const sheet=row.daily;
  for(const day of sheet.entries){
   let elapsed=seconds(day.endTime)-seconds(day.startTime);if(elapsed<0)elapsed+=86400;
   const pause=day.breakStart&&day.breakEnd?seconds(day.breakEnd)-seconds(day.breakStart):seconds(day.breakDuration);
   day.breakDuration=hours(pause);day.startTime=clock(day.startTime);day.endTime=clock(day.endTime);day.breakStart=clock(day.breakStart);day.breakEnd=clock(day.breakEnd);
   day.hours50=day.rate==='50'?hours(elapsed-pause):'00:00:00';day.hours100=day.rate==='100'?hours(elapsed-pause):'00:00:00';
  }
  sheet.entries.sort((a,b)=>a.date.localeCompare(b.date));
  sheet.calculated50=hours(sheet.entries.reduce((sum,day)=>sum+seconds(day.hours50!),0));sheet.calculated100=hours(sheet.entries.reduce((sum,day)=>sum+seconds(day.hours100!),0));
  sheet.total50=sheet.adjustment?.hours50||sheet.calculated50;sheet.total100=sheet.adjustment?.hours100||sheet.calculated100;row.hours50=sheet.total50;row.hours100=sheet.total100;
  sheet.totalHours=hours(seconds(sheet.total50)+seconds(sheet.total100));sheet.entryCount=new Set(sheet.entries.map(entry=>entry.date)).size;
 }
 report.employeeCount=report.rows.length;report.total50=hours(report.rows.reduce((sum,row)=>sum+seconds(row.hours50),0));report.total100=hours(report.rows.reduce((sum,row)=>sum+seconds(row.hours100),0));report.canFinish=report.rows.length>0&&report.rows.every(row=>seconds(row.hours50)+seconds(row.hours100)>0);
}
type Failure='network'|'commit-lost'|'commit-lost-pending'|'validation'|'';
type Response={data:unknown;error:null|{code:string;message:string};status:number};
const listeners=new Set<()=>void>();
const server=new Map<string,OvertimeReport>([['owner-one',initialReport('owner-one')],['owner-two',initialReport('owner-two')]]);
const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30_000,refetchOnWindowFocus:false},mutations:{retry:false}}});
const state={
 actor:'owner-one',url:'/solicitacoes?secao=horas-extras&relatorio=report-one',revision:0,failNextWrite:'' as Failure,
 releaseWrite:null as null|(()=>void),
 readFailures:{} as Record<string,number>,writes:[] as Array<{actor:string;action:string;payload:Record<string,unknown>}>,commits:[] as Array<{actor:string;action:string}>,reads:[] as string[],
 subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);},
 notify(){state.revision++;for(const listener of listeners)listener();},
 report(){return clone(server.get(state.actor)!);},
 async refresh(){await queryClient.invalidateQueries({queryKey:['billing',state.actor,'overtime']});},
 changeReport(patch:Partial<OvertimeReport>){Object.assign(server.get(state.actor)!,clone(patch));bump();},
 changeDaily(employeeId:string,date:string,patch:Partial<OvertimeDailyEntry>={}){
  const sheet=server.get(state.actor)!.rows.find(row=>row.employeeId===employeeId)!.daily!,existing=sheet.entries.find(day=>patch.id?day.id===patch.id:day.date===date);
  if(existing)Object.assign(existing,clone(patch));else sheet.entries.push(entry(date,patch));bump();
 },
 switchActor(actor:string){state.actor=actor;queryClient.clear();state.notify();},
 client:{auth:{async getSession(){return {data:{session:{user:{id:state.actor}}},error:null};}},
  rpc(_name:string,args:{p_resource:string;p_action:string;p_payload:Record<string,unknown>}){return {retry(){return this;},abortSignal(signal:AbortSignal){return handle(args.p_resource,args.p_action,args.p_payload,signal);}};},
 },
};
Object.assign(window,{overtimeRecovery:state});
function bump(){const report=server.get(state.actor)!;report.updatedAt=String(Number(report.updatedAt)+1);recalculate(report);}
function error(code:string,message:string,status=400):Response{return {data:null,error:{code,message},status};}
async function handle(resource:string,action:string,payload:Record<string,unknown>,signal:AbortSignal):Promise<Response>{
 if(signal.aborted)throw new DOMException('Cancelado','AbortError');
 if(resource!=='overtime')throw Error(`Unexpected fixture resource ${resource}/${action}`);
 if(action==='save'||action==='daily-save'){
  state.writes.push({actor:state.actor,action,payload:clone(payload)});
  const fail=state.failNextWrite;state.failNextWrite='';if(fail==='network')throw new TypeError('Failed to fetch');
  if(fail==='validation')return error('22023','Confira os horários do período.');
  const report=server.get(state.actor)!;
  if(payload.expectedUpdatedAt!==report.updatedAt)return error('23514','O relatório foi alterado. Reconsulte os dados.');
  if(action==='save'){
   for(const key of ['dateFrom','dateTo','referenceMonth','sector','notes'] as const)if(typeof payload[key]==='string')report[key]=(payload[key] as string).trim();
   const rows=payload.rows as Array<{employeeId:string}>;
   report.rows=rows.map(row=>report.rows.find(current=>current.employeeId===row.employeeId)??{
    employeeId:row.employeeId,employeeName:employees.find(employee=>employee.id===row.employeeId)!.fullName,registrationNumber:'003',jobTitle:'Operadora',hours50:'00:00:00',hours100:'00:00:00',source:'daily',daily:daily(row.employeeId),
   });
  }else{
   const sheet=report.rows.find(row=>row.employeeId===payload.employeeId)!.daily!;
   sheet.activity=String(payload.activity).trim();sheet.sector=String(payload.sector).trim();sheet.entries=clone(payload.entries as OvertimeDailyEntry[]);sheet.adjustment=clone(payload.adjustment as OvertimeDaily['adjustment']);
  }
  bump();state.commits.push({actor:state.actor,action});
  if(fail==='commit-lost-pending')await new Promise<void>(resolve=>{state.releaseWrite=()=>{state.releaseWrite=null;resolve();};});
  if(fail==='commit-lost'||fail==='commit-lost-pending')throw new TypeError('Failed to fetch after commit');
  return {data:action==='save'?{report:clone(report),created:false}:{report:clone(report),daily:clone(report.rows.find(row=>row.employeeId===payload.employeeId)!.daily)},error:null,status:200};
 }
 state.reads.push(action);const failure=state.readFailures[action];
 if(failure)return error(failure===403?'42501':'TRANSPORT_TEST',failure===403?'Acesso revogado':'Servidor temporariamente indisponível',failure);
 const report=clone(server.get(state.actor)!);
 if(action==='options')return {data:{employees,canManage:true,canRegisterEmployees:false},error:null,status:200};
 if(action==='list')return {data:{reports:[report],counts:{open:1,finished:0},canManage:true},error:null,status:200};
 if(action==='get')return {data:{report,canManage:true},error:null,status:200};
 if(action==='daily-get')return {data:{report,daily:report.rows.find(row=>row.employeeId===payload.employeeId)!.daily},error:null,status:200};
 throw Error(`Unexpected fixture action ${action}`);
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><ModuleNavigationProvider initialHref={location.pathname+location.search}><FeedbackProvider><OvertimePage/></FeedbackProvider></ModuleNavigationProvider></QueryClientProvider>);
