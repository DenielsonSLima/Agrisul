'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {CalendarDays,Loader2,Plus,SlidersHorizontal,Trash2} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {notifications,useConfirmation} from '@/shared/feedback';
import {useEmployeeMutations} from '@/modules/cadastro/funcionarios/hooks/useEmployees';
import {EmployeeForm} from '@/modules/cadastro/funcionarios/components/EmployeeForm';
import type {OvertimeEmployee,OvertimeInput,OvertimeReport,OvertimeRowInput} from '../types';
import {OvertimeDailyDialog} from './OvertimeDailyDialog';
import {fetchOvertimeReport} from '../services/overtimeApi';
import {OvertimeEmployeeSelect} from './OvertimeEmployeeSelect';
import {OvertimeAddEmployeesModal} from './OvertimeAddEmployeesModal';
import {useOvertimeAutoSave,type OvertimeSaveStatus} from '../hooks/useOvertimeAutoSave';

type DraftRow=OvertimeRowInput & {key:string};
export function OvertimeForm({report,employees,companyId,busy,error,onSave,canRegisterEmployees=false,onStatusChange,readOnly=false}:{report?:OvertimeReport;employees:OvertimeEmployee[];companyId:string;busy:boolean;error:string;onClose:()=>void;onSave:(input:OvertimeInput)=>Promise<OvertimeReport>;canRegisterEmployees?:boolean;onStatusChange?:(status:OvertimeSaveStatus)=>void;readOnly?:boolean}){
 const confirm=useConfirmation();
 const [daily,setDaily]=useState<{employeeId:string;report:OvertimeReport;adjustment:boolean}|null>(null),[openingDaily,setOpeningDaily]=useState(false);
 const dailyController=useRef<AbortController|null>(null);
 const employeeMutations=useEmployeeMutations(),[registeringFor,setRegisteringFor]=useState<string|null>(null);
 const [addingEmployees,setAddingEmployees]=useState(false);
 const mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;dailyController.current?.abort();};},[]);
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
 const [metadata,setMetadata]=useState(()=>({dateFrom:report?.dateFrom??today,dateTo:report?.dateTo??today,referenceMonth:report?.referenceMonth??today.slice(0,7),sector:report?.sector??'',notes:report?.notes??''}));
 const [rows,setRows]=useState<DraftRow[]>(()=>report?.rows.length?report.rows.map(row=>({key:crypto.randomUUID(),employeeId:row.employeeId,hours50:row.hours50,hours100:row.hours100})):[{key:crypto.randomUUID(),employeeId:'',hours50:'',hours100:''}]);
 const availableEmployees=readOnly&&report?report.rows.map(row=>({id:row.employeeId,fullName:row.employeeName,registrationNumber:row.registrationNumber,jobTitle:row.jobTitle})):employees;
 const patchRow=(key:string,patch:Partial<OvertimeRowInput>)=>setRows(current=>current.map(row=>row.key===key?{...row,...patch}:row));
 const autosave=useOvertimeAutoSave({companyId,id:report?.id,...metadata,rows:rows.filter(row=>!!row.employeeId).map(({employeeId,hours50,hours100})=>({employeeId,hours50,hours100}))},readOnly?undefined:report,onSave,onStatusChange);
 const acceptSnapshot=(snapshot:OvertimeReport)=>{
  const nextMetadata={dateFrom:snapshot.dateFrom,dateTo:snapshot.dateTo,referenceMonth:snapshot.referenceMonth,sector:snapshot.sector,notes:snapshot.notes};
  const nextRows=snapshot.rows.map(row=>({employeeId:row.employeeId,hours50:row.hours50,hours100:row.hours100}));
  autosave.acceptSnapshot({companyId,id:snapshot.id,...nextMetadata,rows:nextRows},snapshot.updatedAt);
  setMetadata(nextMetadata);setRows(nextRows.map(row=>({...row,key:crypto.randomUUID()})));
 };
 const openDaily=async(employeeId:string,adjustment=false)=>{
  if(!report||openingDaily)return;setOpeningDaily(true);
  try{
   if(!readOnly&&!await autosave.flush())return;
   const controller=new AbortController();dailyController.current=controller;
   const snapshot=await fetchOvertimeReport(companyId,report.id,controller.signal);
   if(mounted.current&&!controller.signal.aborted){acceptSnapshot(snapshot);setDaily({employeeId,report:snapshot,adjustment});}
  }catch(reason){if(mounted.current)notifications.error(reason instanceof Error?reason.message:'Não foi possível abrir os lançamentos.');}
  finally{if(mounted.current)setOpeningDaily(false);}
 };
 const remove=async(row:DraftRow)=>{
  if(row.employeeId||row.hours50||row.hours100){
   if(!await confirm({title:'Remover funcionário do relatório?',description:'O funcionário, seus lançamentos diários e ajustes serão removidos deste relatório. A alteração será salva automaticamente.',confirmLabel:'Remover funcionário',tone:'destructive'}))return;
  }
  setRows(current=>current.filter(item=>item.key!==row.key));
 };
 const submit=(event:FormEvent)=>{event.preventDefault();if(!busy&&!readOnly)void autosave.flush();};
 return <><form className="overtime-editor" onSubmit={submit} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))void autosave.flush();}}>
  <fieldset disabled={busy||openingDaily||!!daily}>
   <div className="overtime-metadata">
    <Field label="Data inicial *"><input type="date" disabled={readOnly} required value={metadata.dateFrom} onChange={event=>setMetadata({...metadata,dateFrom:event.target.value})}/></Field>
    <Field label="Data final *"><input type="date" disabled={readOnly} required value={metadata.dateTo} onChange={event=>setMetadata({...metadata,dateTo:event.target.value})}/></Field>
    <Field label="Mês de referência (automático)"><input type="month" readOnly value={report?.referenceMonth??metadata.referenceMonth} title="Calculado pelo mês com mais dias no período."/></Field>
    <Field label="Setor"><input disabled={readOnly} maxLength={120} value={metadata.sector} onChange={event=>setMetadata({...metadata,sector:event.target.value})} placeholder="Ex.: Agrícola"/></Field>
   </div>
   <Field label="Observação"><textarea disabled={readOnly} className="overtime-notes-input" rows={3} maxLength={2000} value={metadata.notes} onChange={event=>setMetadata({...metadata,notes:event.target.value})}/></Field>
   <div className="overtime-editor-note"><p>Clique no funcionário para {readOnly?'consultar':'lançar'} as horas de cada dia. O resumo é calculado automaticamente.{!readOnly&&' Use Ajustar apenas para corrigir os totais.'}</p>{!readOnly&&canRegisterEmployees&&<button type="button" className="btn small" onClick={()=>setRegisteringFor(rows.find(row=>!row.employeeId)?.key??rows[0]?.key??'new')}><Plus size={15}/>Cadastrar funcionário</button>}</div>
   <div className="overtime-table-wrap"><table className="overtime-table overtime-edit-table"><thead><tr><th scope="col">Funcionário</th><th scope="col">Matrícula</th><th scope="col">Cargo</th><th scope="col">Horas extras 50%</th><th scope="col">Horas extras 100%</th><th scope="col"><span className="sr-only">Remover</span></th></tr></thead><tbody>{rows.map((row,index)=>{
    const employee=availableEmployees.find(item=>item.id===row.employeeId);
    const savedRow=report?.rows.find(item=>item.employeeId===row.employeeId);
    return <tr key={row.key}><td>{row.employeeId?<button type="button" className="overtime-employee-open" onClick={()=>void openDaily(row.employeeId)}><span><strong>{employee?.fullName||savedRow?.employeeName||'Funcionário'}</strong><small><CalendarDays size={13}/>{readOnly?'Consultar lançamentos':'Lançamentos diários'}</small></span></button>:<OvertimeEmployeeSelect label={`Funcionário da linha ${index+1}`} employees={availableEmployees} value={row.employeeId} onChange={employeeId=>patchRow(row.key,{employeeId})} onCreate={canRegisterEmployees?()=>setRegisteringFor(row.key):undefined}/>}</td><td>{employee?.registrationNumber||savedRow?.registrationNumber||'—'}</td><td>{employee?.jobTitle||savedRow?.jobTitle||<span className="overtime-missing-role">{employee?'Cadastre o cargo':'—'}</span>}</td><td><output aria-label={`Horas extras 50% da linha ${index+1}`}>{savedRow?.hours50||'00:00:00'}</output></td><td><output aria-label={`Horas extras 100% da linha ${index+1}`}>{savedRow?.hours100||'00:00:00'}</output></td><td><div className="overtime-row-actions">{!readOnly&&row.employeeId&&<button className="btn small" type="button" onClick={()=>void openDaily(row.employeeId,true)}><SlidersHorizontal size={14}/>Ajustar</button>}<button hidden={readOnly} type="button" className="icon-btn overtime-delete" aria-label={`Remover linha ${index+1}`} onClick={()=>void remove(row)}><Trash2 size={16}/></button></div></td></tr>;
   })}</tbody></table></div>
   <button hidden={readOnly} type="button" className="btn overtime-add-row" onClick={()=>setAddingEmployees(true)} disabled={rows.filter(row=>row.employeeId).length>=500}><Plus size={16}/>Adicionar funcionários</button>
  </fieldset>
  <section className="overtime-draft-summary" aria-label="Resumo das horas extras"><h3>Resumo do relatório</h3><div><span>Total de horas 50%</span><output aria-label="Total de horas 50%">{report?.total50??'00:00:00'}</output></div><div><span>Total de horas 100%</span><output aria-label="Total de horas 100%">{report?.total100??'00:00:00'}</output></div></section>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="overtime-auto-save-status" role="status">{readOnly?'Consulta do relatório.':autosave.status==='saving'?<><Loader2 className="animate-spin" size={14}/>Salvando automaticamente…</>:autosave.status==='error'?'Não foi possível salvar. Confira a mensagem acima.':'Alterações salvas automaticamente.'}</div>
 </form>{daily&&<OvertimeDailyDialog report={daily.report} employeeId={daily.employeeId} readOnly={readOnly||daily.report.status==='finished'} initialAdjustment={daily.adjustment} onClose={()=>setDaily(null)} onSaved={snapshot=>{acceptSnapshot(snapshot);setDaily(current=>current?{...current,report:snapshot}:current);}}/>}{addingEmployees&&!readOnly&&<OvertimeAddEmployeesModal employees={employees.filter(employee=>!rows.some(row=>row.employeeId===employee.id))} maxSelections={500-rows.filter(row=>row.employeeId).length} onClose={()=>setAddingEmployees(false)} onAdd={ids=>{
  setRows(current=>{
   const remaining=ids.filter(id=>!current.some(row=>row.employeeId===id));
   const filled=current.map(row=>!row.employeeId&&remaining.length?{...row,employeeId:remaining.shift()!}:row);
   return [...filled,...remaining.slice(0,500-filled.length).map(employeeId=>({key:crypto.randomUUID(),employeeId,hours50:'',hours100:''}))];
  });setAddingEmployees(false);
 }}/>}
 {registeringFor!==null&&<EmployeeForm requireJobTitle onClose={()=>setRegisteringFor(null)} onSave={async input=>{
  const employee=await employeeMutations.save(input);if(!mounted.current)return employee;
  if(registeringFor==='new')setRows(current=>[...current,{key:crypto.randomUUID(),employeeId:employee.id,hours50:'',hours100:''}]);
  else patchRow(registeringFor,{employeeId:employee.id});
  setRegisteringFor(null);notifications.created('O funcionário foi cadastrado e selecionado neste relatório.');return employee;
 }}/>}</>;
}
