'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Download,Loader2,RotateCcw,Save,SlidersHorizontal} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import {notifications,useConfirmation} from '@/shared/feedback';
import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import type {ReportPdfBrand} from '@/shared/reporting/types';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {assertSessionActor} from '@/shared/supabase/sessionActor';
import {RpcError} from '@/shared/supabase/rpc';
import {dateLabel} from '@/shared/utils/presentation';
import {useOvertimeDaily,useOvertimeMutations} from '../hooks/useOvertime';
import {fetchOvertimeBrand} from '../services/overtimeBrandApi';
import {fetchOvertimeDaily} from '../services/overtimeApi';
import {fetchOvertimeDetail} from '../services/overtimeApi';
import {blockingOvertimeRead,recoverDailyDraft,type DailyDraft} from '../utils/draftRecovery';
import type {OvertimeDaily,OvertimeDailyEntry,OvertimeDailyResult,OvertimeReport,OvertimeRow} from '../types';
import {OvertimeDurationInput} from './OvertimeDurationInput';

type Props={report:OvertimeReport;employeeId:string;readOnly:boolean;initialAdjustment?:boolean;onClose:()=>void;onSaved:(report:OvertimeReport)=>void};
type DailyPdfSnapshot={report:OvertimeReport;row:OvertimeRow};
async function createDailyPdf(snapshot:DailyPdfSnapshot,brand:ReportPdfBrand){
 const {createDailyOvertimePdf}=await import('../reporting/dailyOvertimePdf');
 return createDailyOvertimePdf(snapshot.report,snapshot.row,brand);
}
function blankDay(date:string):OvertimeDailyEntry{return {date,startTime:'',breakStart:'',breakEnd:'',breakDuration:'00:00:00',endTime:'',rate:'50',reason:'',approval:''};}
function calendarEntries(report:OvertimeReport,daily:OvertimeDaily){
 const entries=new Map(daily.entries.map(entry=>[entry.date,entry]));
 const days:OvertimeDailyEntry[]=[];
 const cursor=new Date(report.dateFrom+'T12:00:00Z'),end=new Date(report.dateTo+'T12:00:00Z');
 for(;cursor<=end&&days.length<366;cursor.setUTCDate(cursor.getUTCDate()+1)){
  const date=cursor.toISOString().slice(0,10);days.push({...blankDay(date),...entries.get(date)});
 }
 return days;
}
const hasValues=(entry:OvertimeDailyEntry)=>!!(entry.startTime||entry.endTime||entry.breakStart||entry.breakEnd||entry.reason||entry.approval||(entry.breakDuration&&entry.breakDuration!=='00:00:00'));
function inputEntries(entries:OvertimeDailyEntry[]){return entries.filter(hasValues).map(({date,startTime,breakStart,breakEnd,breakDuration,endTime,rate,reason,approval})=>({date,startTime,breakStart,breakEnd,breakDuration:breakStart||breakEnd?'':breakDuration,endTime,rate,reason,approval}));}

export function OvertimeDailyDialog(props:Props){
 const [openedRevision]=useState(props.report.updatedAt);
 const query=useOvertimeDaily(props.report.companyId,props.report.id,props.employeeId,openedRevision);
 const employee=props.report.rows.find(row=>row.employeeId===props.employeeId);
 const oversized=(Date.parse(props.report.dateTo)-Date.parse(props.report.dateFrom))/86400000>=366;
 return <Dialog open onOpenChange={open=>{if(!open)document.getElementById('overtime-daily-close')?.click();}}><DialogContent className="form-modal overtime-daily-modal" showCloseButton={false} onEscapeKeyDown={event=>{event.preventDefault();document.getElementById('overtime-daily-close')?.click();}} onPointerDownOutside={event=>event.preventDefault()}>
  <DialogHeader><DialogTitle>{employee?.employeeName||'Lançamentos diários'}</DialogTitle><DialogDescription>{employee?.registrationNumber?'Matrícula '+employee.registrationNumber+' · ':''}{dateLabel(props.report.dateFrom)} a {dateLabel(props.report.dateTo)}</DialogDescription></DialogHeader>
  {oversized?<div role="alert"><p>Os lançamentos diários aceitam períodos de até 366 dias. Ajuste as datas do relatório para continuar.</p><button id="overtime-daily-close" className="btn" onClick={props.onClose}>Fechar</button></div>:query.loading?<div className="client-loading" role="status"><Loader2 className="animate-spin" size={20}/>Carregando lançamentos…<button id="overtime-daily-close" className="btn" onClick={props.onClose}>Fechar</button></div>:blockingOvertimeRead(query)?<div role="alert"><p className="form-error">{query.error}</p><div className="form-actions"><button className="btn" onClick={()=>void query.reload()}>Tentar novamente</button><button id="overtime-daily-close" className="btn" onClick={props.onClose}>Fechar</button></div></div>:query.data?<><p hidden={!query.error} className="form-error" role={query.error?'alert':undefined}>{query.error&&<>Não foi possível atualizar os dados. Seu rascunho foi mantido. <button className="btn small" onClick={()=>void query.reload()}>Reconsultar dados</button></>}</p><DailyEditor key={props.employeeId} {...props} initial={query.data}/></>:null}
 </DialogContent></Dialog>;
}
function DailyEditor({initial,report,employeeId,readOnly,initialAdjustment=false,onSaved,onClose}:Props&{initial:OvertimeDailyResult}){
 const {user}=useAuth(),confirm=useConfirmation(),mutations=useOvertimeMutations();
 const [saved,setSaved]=useState(initial),[entries,setEntries]=useState(()=>calendarEntries(initial.report,initial.daily));
 const [activity,setActivity]=useState(initial.daily.activity),[sector,setSector]=useState(initial.daily.sector);
 const [adjustment,setAdjustment]=useState(initial.daily.adjustment),[showAdjustment,setShowAdjustment]=useState(initialAdjustment||!!initial.daily.adjustment);
 const [error,setError]=useState(''),[exporting,setExporting]=useState(false),[exportData,setExportData]=useState<{snapshot:DailyPdfSnapshot;brand:ReportPdfBrand}|null>(null);
 const [needsRecovery,setNeedsRecovery]=useState(false),[hasConflict,setHasConflict]=useState(false),[recovering,setRecovering]=useState(false),[accessBlocked,setAccessBlocked]=useState(false);
 const mounted=useRef(false),controller=useRef<AbortController|null>(null),saving=useRef(false);
 const submitted=useRef<DailyDraft|undefined>(undefined);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 const values={activity,sector,entries:inputEntries(entries),adjustment};
 const savedValues={activity:saved.daily.activity,sector:saved.daily.sector,entries:inputEntries(saved.daily.entries),adjustment:saved.daily.adjustment};
 const dirty=JSON.stringify(values)!==JSON.stringify(savedValues),busy=mutations.savingDaily||exporting||recovering;
 const row=saved.report.rows.find(item=>item.employeeId===employeeId);
 const hasLegacySummary=row?.source==='legacy'&&!saved.daily.hasDailyEntries&&[saved.daily.legacyHours50,saved.daily.legacyHours100].some(value=>value&&!/^0+:00:00$/.test(value));
 const patch=(date:string,value:Partial<OvertimeDailyEntry>)=>setEntries(current=>current.map(entry=>entry.date===date?{...entry,...value}:entry));
 const close=async()=>{
  if(busy)return;
  if(dirty&&!await confirm({title:'Descartar alterações deste funcionário?',description:'Os lançamentos e ajustes ainda não salvos serão descartados.',confirmLabel:'Descartar alterações',tone:'destructive'}))return;
  onClose();
 };
 const submit=async(event:FormEvent)=>{
  event.preventDefault();if(readOnly||saving.current||busy||needsRecovery||!dirty)return;
  if(hasLegacySummary&&!await confirm({title:'Atualizar o resumo deste funcionário?',description:'As horas do resumo anterior serão substituídas pelos lançamentos diários e pelo ajuste informado. Confira os totais após salvar.',confirmLabel:'Salvar lançamentos'}))return;
  if(!values.entries.length&&!adjustment&&(saved.daily.hasDailyEntries||saved.daily.adjustment)&&!await confirm({title:'Zerar as horas deste funcionário?',description:'Todos os lançamentos diários e o ajuste serão removidos. As horas no resumo ficarão zeradas.',confirmLabel:'Zerar horas',tone:'destructive'}))return;
  saving.current=true;setError('');
  try{
   submitted.current=values;
   const result=await mutations.saveDaily({companyId:report.companyId,id:report.id,employeeId,expectedUpdatedAt:saved.report.updatedAt,...values});
   if(!mounted.current)return;acceptSaved(result);notifications.saved('Os lançamentos e o resumo do funcionário foram atualizados.');
  }catch(reason){if(mounted.current){setNeedsRecovery(true);const message=reason instanceof Error?reason.message:'Não foi possível salvar os lançamentos.';setError(message);notifications.error(message);}}
  finally{saving.current=false;}
 };
 const acceptSaved=(result:OvertimeDailyResult)=>{
  submitted.current=undefined;
  setSaved(result);setEntries(calendarEntries(result.report,result.daily));setActivity(result.daily.activity);setSector(result.daily.sector);setAdjustment(result.daily.adjustment);setNeedsRecovery(false);setHasConflict(false);setError('');onSaved(result.report);
 };
 const recover=async(discard=false)=>{
  if(!user||readOnly||saving.current||busy)return;
  saving.current=true;setRecovering(true);setError('');const actorId=user.id,current=new AbortController();controller.current=current;
  try{
   await assertSessionActor(actorId);
   const [latest,detail]=await Promise.all([fetchOvertimeDaily(report.companyId,report.id,employeeId,current.signal),fetchOvertimeDetail(report.companyId,report.id,current.signal)]);
   await assertSessionActor(actorId);if(!mounted.current||current.signal.aborted)return;
   if(!detail.canManage||detail.report.status!=='open'||latest.report.status!=='open')throw new Error('O relatório não está disponível para edição. Seu rascunho foi mantido. Feche e abra novamente para consultar a versão atual.');
   if(discard){
    if(!await confirm({title:'Carregar os lançamentos atuais?',description:'Os horários e ajustes ainda não salvos serão descartados e substituídos pelos dados atuais deste funcionário.',confirmLabel:'Carregar versão atual',tone:'destructive'}))return;
    if(mounted.current&&!current.signal.aborted)acceptSaved(latest);return;
   }
   const recovered=recoverDailyDraft(saved.daily,values,latest.daily,latest.report,submitted.current);
   if(recovered.conflicts.length){setHasConflict(true);setError('Há alterações concorrentes em: '+recovered.conflicts.join(', ')+'. Seu rascunho foi mantido. Confira-o antes de carregar a versão atual.');return;}
   if(recovered.alreadySaved){acceptSaved(latest);notifications.saved('Os lançamentos já estavam salvos e foram conferidos.');return;}
   submitted.current=recovered.input;
   const result=await mutations.saveDaily({companyId:report.companyId,id:report.id,employeeId,expectedUpdatedAt:latest.report.updatedAt,...recovered.input});
   if(mounted.current&&!current.signal.aborted){acceptSaved(result);notifications.saved('Os lançamentos e o resumo do funcionário foram atualizados.');}
  }catch(reason){if(mounted.current){if(reason instanceof RpcError&&[401,403,404].includes(reason.status))setAccessBlocked(true);setNeedsRecovery(true);const message=reason instanceof Error?reason.message:'Não foi possível recuperar os lançamentos.';setError(message);notifications.error(message);}}
  finally{saving.current=false;if(mounted.current)setRecovering(false);}
 };
 const exportPdf=async()=>{
  if(!user||!row||busy||dirty)return;const actorId=user.id,current=new AbortController();controller.current=current;setExporting(true);setError('');
  try{
   await assertSessionActor(actorId);
   const [latest,brand]=await Promise.all([fetchOvertimeDaily(report.companyId,report.id,employeeId,current.signal),fetchOvertimeBrand(report.companyId,current.signal)]);
   await assertSessionActor(actorId);
   const latestRow=latest.report.rows.find(item=>item.employeeId===employeeId);if(!latestRow)throw new Error('O funcionário não está mais neste relatório.');
   if(mounted.current&&!current.signal.aborted)setExportData({snapshot:{report:latest.report,row:{...latestRow,daily:latest.daily}},brand});
  }
  catch(reason){if(mounted.current){const message=reason instanceof Error?reason.message:'Não foi possível gerar o relatório individual.';setError(message);notifications.error(message);}}
  finally{if(mounted.current)setExporting(false);}
 };
 if(accessBlocked)return <div role="alert"><p className="form-error">{error}</p><button id="overtime-daily-close" className="btn" onClick={onClose}>Fechar</button></div>;
 return <><form className="overtime-daily-editor" onSubmit={event=>void submit(event)}>
  <div className="overtime-daily-intro"><p>Informe o período de <strong>hora extra</strong> de cada dia. O banco calcula a duração, desconta o intervalo informado e atualiza o resumo mensal.</p>{hasLegacySummary&&<p className="overtime-legacy-note">Este funcionário possui horas no resumo anterior, sem detalhamento diário. Elas serão preservadas até você salvar os lançamentos ou um ajuste.</p>}</div>
  <fieldset disabled={readOnly||busy}>
   <div className="overtime-daily-metadata"><Field label="Atividade"><input maxLength={120} value={activity} onChange={event=>setActivity(event.target.value)} placeholder="Atividade do funcionário"/></Field><Field label="Setor"><input maxLength={120} value={sector} onChange={event=>setSector(event.target.value)} placeholder="Setor"/></Field></div>
   <p className="overtime-daily-help">Intervalo: preencha saída e retorno, ou informe a duração a descontar. Sem intervalo, mantenha 00:00:00. Horário final anterior ao inicial indica término no dia seguinte.</p>
   <div className="overtime-table-wrap overtime-daily-scroll"><table className="overtime-table overtime-daily-table"><thead><tr><th scope="col">Dia</th><th scope="col">Inicial</th><th scope="col">Saída intervalo</th><th scope="col">Retorno</th><th scope="col">Final</th><th scope="col">Desconto intervalo</th><th scope="col">Tipo</th><th scope="col">Total salvo</th><th scope="col">Motivo da hora extra</th><th scope="col">Visto</th>{!readOnly&&<th scope="col"><span className="sr-only">Limpar dia</span></th>}</tr></thead><tbody>{entries.map(entry=>{
    const original=saved.daily.entries.find(item=>item.date===entry.date),changed=JSON.stringify(inputEntries([entry]))!==JSON.stringify(inputEntries(original?[original]:[]));
    const day=new Date(entry.date+'T12:00:00Z').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',weekday:'short',timeZone:'UTC'});
    return <tr key={entry.date}><th scope="row">{day}</th>{(['startTime','breakStart','breakEnd','endTime'] as const).map(key=><td key={key}><input type="time" step={1} aria-label={`${{startTime:'Inicial',breakStart:'Saída intervalo',breakEnd:'Retorno',endTime:'Final'}[key]} de ${dateLabel(entry.date)}`} value={entry[key]} onChange={event=>patch(entry.date,{[key]:event.target.value,hours50:undefined,hours100:undefined})}/></td>)}<td>{entry.breakStart||entry.breakEnd?<span className="overtime-daily-calculated">Pelos horários</span>:<OvertimeDurationInput label={'Intervalo a descontar em '+dateLabel(entry.date)} value={entry.breakDuration} onChange={value=>patch(entry.date,{breakDuration:value})}/>}</td><td><select aria-label={'Tipo de hora extra em '+dateLabel(entry.date)} value={entry.rate} onChange={event=>patch(entry.date,{rate:event.target.value as '50'|'100'})}><option value="50">50%</option><option value="100">100%</option></select></td><td className="overtime-daily-saved-hours">{changed&&hasValues(entry)?'Salvar para calcular':entry.rate==='100'?entry.hours100||'—':entry.hours50||'—'}</td><td><input aria-label={'Motivo de '+dateLabel(entry.date)} maxLength={500} value={entry.reason} onChange={event=>patch(entry.date,{reason:event.target.value})}/></td><td><input aria-label={'Visto de '+dateLabel(entry.date)} maxLength={120} value={entry.approval} onChange={event=>patch(entry.date,{approval:event.target.value})}/></td>{!readOnly&&<td><button type="button" className="icon-btn" disabled={!hasValues(entry)} aria-label={'Limpar '+dateLabel(entry.date)} onClick={async()=>{if(await confirm({title:'Limpar lançamentos do dia?',description:'Os horários, motivo e visto de '+dateLabel(entry.date)+' serão removidos quando você salvar.',confirmLabel:'Limpar dia',tone:'destructive'}))patch(entry.date,blankDay(entry.date));}}><RotateCcw size={15}/></button></td>}</tr>;
   })}</tbody></table></div>
   <div className="overtime-daily-adjust-heading"><button className="btn" type="button" onClick={()=>setShowAdjustment(value=>!value)}><SlidersHorizontal size={16}/>Ajustar totais</button>{adjustment&&<span>Ajuste manual ativo</span>}</div>
   {showAdjustment&&<section className="overtime-daily-adjustment" aria-label="Ajuste excepcional dos totais"><p>O ajuste substitui os totais calculados deste funcionário. Informe o total correto e o motivo. Remover o ajuste restaura os totais dos lançamentos diários.</p>{adjustment?<><div className="overtime-daily-adjust-fields"><Field label="Total ajustado 50%"><OvertimeDurationInput label="Total ajustado 50%" value={adjustment.hours50} onChange={hours50=>setAdjustment(current=>current?{...current,hours50}:current)}/></Field><Field label="Total ajustado 100%"><OvertimeDurationInput label="Total ajustado 100%" value={adjustment.hours100} onChange={hours100=>setAdjustment(current=>current?{...current,hours100}:current)}/></Field><Field label="Motivo do ajuste *"><input required maxLength={500} value={adjustment.reason} onChange={event=>setAdjustment(current=>current?{...current,reason:event.target.value}:current)}/></Field></div><button type="button" className="btn small overtime-delete" onClick={async()=>{if(await confirm({title:'Remover ajuste dos totais?',description:'Ao salvar, os totais voltarão a ser calculados pelos lançamentos diários.',confirmLabel:'Remover ajuste',tone:'destructive'}))setAdjustment(null);}}>Remover ajuste</button></>:<button type="button" className="btn" onClick={()=>setAdjustment({hours50:saved.daily.total50,hours100:saved.daily.total100,reason:''})}>Informar ajuste</button>}</section>}
  </fieldset>
  <section className="overtime-draft-summary" aria-label="Totais salvos do funcionário"><h3>{dirty?'Totais salvos · alterações pendentes':'Totais do funcionário'}</h3><div><span>50%{saved.daily.adjustment?' · ajustado':''}</span><output>{saved.daily.total50}</output></div><div><span>100%{saved.daily.adjustment?' · ajustado':''}</span><output>{saved.daily.total100}</output></div></section>
  {saved.daily.adjustment&&<p className="overtime-daily-help">Calculado pelos dias: 50% {saved.daily.calculated50} · 100% {saved.daily.calculated100}. Motivo do ajuste salvo: {saved.daily.adjustment.reason}</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  {needsRecovery&&!readOnly&&<div className="overtime-recovery-actions"><button className="btn" type="button" disabled={busy} onClick={()=>void recover()}>Reconsultar e tentar salvar</button>{hasConflict&&<button className="btn" type="button" disabled={busy} onClick={()=>void recover(true)}>Carregar versão atual</button>}</div>}
  <div className="overtime-daily-actions"><button id="overtime-daily-close" type="button" className="btn" disabled={busy} onClick={()=>void close()}>Fechar</button><span role="status">{dirty?'Salve para atualizar os totais e exportar.':'Lançamentos salvos.'}</span><button type="button" className="btn" disabled={busy||dirty||needsRecovery} onClick={()=>void exportPdf()}>{exporting?<Loader2 size={16} className="animate-spin"/>:<Download size={16}/>}Exportar individual</button>{!readOnly&&<button className="btn company-primary" type="submit" disabled={busy||!dirty||needsRecovery}>{mutations.savingDaily?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>}Salvar lançamentos</button>}</div>
 </form>{exportData&&<PdfExportDialog companyId={report.companyId} snapshot={exportData.snapshot} brand={exportData.brand} createPdf={createDailyPdf} orientation="portrait" allowShare title="Informativo individual de horas extras" description={(row?.employeeName||'Funcionário')+' · '+dateLabel(report.dateFrom)+' a '+dateLabel(report.dateTo)} onClose={()=>setExportData(null)}/>}</>;
}
