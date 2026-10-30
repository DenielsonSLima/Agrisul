'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Loader2,Plus,Trash2} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {notifications,useConfirmation} from '@/shared/feedback';
import {useEmployeeMutations} from '@/modules/cadastro/funcionarios/hooks/useEmployees';
import {EmployeeForm} from '@/modules/cadastro/funcionarios/components/EmployeeForm';
import {useOvertimeTotals} from '../hooks/useOvertime';
import type {OvertimeEmployee,OvertimeInput,OvertimeReport,OvertimeRowInput} from '../types';
import {OvertimeDurationInput} from './OvertimeDurationInput';
import {OvertimeEmployeeSelect} from './OvertimeEmployeeSelect';
import {useOvertimeAutoSave,type OvertimeSaveStatus} from '../hooks/useOvertimeAutoSave';

type DraftRow=OvertimeRowInput & {key:string};
export function OvertimeForm({report,employees,companyId,busy,error,onSave,canRegisterEmployees=false,onStatusChange}:{report?:OvertimeReport;employees:OvertimeEmployee[];companyId:string;busy:boolean;error:string;onClose:()=>void;onSave:(input:OvertimeInput)=>Promise<OvertimeReport>;canRegisterEmployees?:boolean;onStatusChange?:(status:OvertimeSaveStatus)=>void}){
 const confirm=useConfirmation();
 const inputs100=useRef(new Map<string,HTMLInputElement>());
 const employeeMutations=useEmployeeMutations(),[registeringFor,setRegisteringFor]=useState<string|null>(null);
 const mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
 const [metadata,setMetadata]=useState(()=>({dateFrom:report?.dateFrom??today,dateTo:report?.dateTo??today,referenceMonth:report?.referenceMonth??today.slice(0,7),sector:report?.sector??'',notes:report?.notes??''}));
 const [rows,setRows]=useState<DraftRow[]>(()=>report?.rows.length?report.rows.map(row=>({key:crypto.randomUUID(),employeeId:row.employeeId,hours50:row.hours50,hours100:row.hours100})):[{key:crypto.randomUUID(),employeeId:'',hours50:'',hours100:''}]);
 const patchRow=(key:string,patch:Partial<OvertimeRowInput>)=>setRows(current=>current.map(row=>row.key===key?{...row,...patch}:row));
 const totals=useOvertimeTotals(companyId,rows.map(({hours50,hours100})=>({hours50,hours100})));
 const autosave=useOvertimeAutoSave({companyId,id:report?.id,...metadata,rows:rows.filter(row=>!!row.employeeId).map(({employeeId,hours50,hours100})=>({employeeId,hours50,hours100}))},report,onSave,onStatusChange);
 const remove=async(row:DraftRow)=>{
  if(row.employeeId||row.hours50||row.hours100){
   if(!await confirm({title:'Remover funcionário do relatório?',description:'Esta linha será retirada do formulário. A alteração será gravada quando você salvar o relatório.',confirmLabel:'Remover linha',tone:'destructive'}))return;
  }
  setRows(current=>current.filter(item=>item.key!==row.key));
 };
 const submit=(event:FormEvent)=>{event.preventDefault();if(!busy)void autosave.flush();};
 return <><form className="overtime-editor" onSubmit={submit} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))void autosave.flush();}}>
  <fieldset disabled={busy}>
   <div className="overtime-metadata">
    <Field label="Data inicial *"><input type="date" required value={metadata.dateFrom} onChange={event=>setMetadata({...metadata,dateFrom:event.target.value})}/></Field>
    <Field label="Data final *"><input type="date" required value={metadata.dateTo} onChange={event=>setMetadata({...metadata,dateTo:event.target.value})}/></Field>
    <Field label="Mês de referência *"><input type="month" required value={metadata.referenceMonth} onChange={event=>setMetadata({...metadata,referenceMonth:event.target.value})}/></Field>
    <Field label="Setor"><input maxLength={120} value={metadata.sector} onChange={event=>setMetadata({...metadata,sector:event.target.value})} placeholder="Ex.: Agrícola"/></Field>
   </div>
   <Field label="Observação"><textarea className="overtime-notes-input" rows={3} maxLength={2000} value={metadata.notes} onChange={event=>setMetadata({...metadata,notes:event.target.value})}/></Field>
   <div className="overtime-editor-note"><p>Digite na ordem <strong>horas, minutos e segundos</strong>: 50 → 50:00:00 · 5022 → 50:22:00. Ao completar 50%, o cursor segue para 100%.</p>{canRegisterEmployees&&<button type="button" className="btn small" onClick={()=>setRegisteringFor(rows.find(row=>!row.employeeId)?.key??rows[0]?.key??'new')}><Plus size={15}/>Cadastrar funcionário</button>}</div>
   <div className="overtime-table-wrap"><table className="overtime-table overtime-edit-table"><thead><tr><th scope="col">Funcionário</th><th scope="col">Matrícula</th><th scope="col">Cargo</th><th scope="col">Horas extras 50%</th><th scope="col">Horas extras 100%</th><th scope="col"><span className="sr-only">Remover</span></th></tr></thead><tbody>{rows.map((row,index)=>{
    const employee=employees.find(item=>item.id===row.employeeId);
    return <tr key={row.key}><td><OvertimeEmployeeSelect label={`Funcionário da linha ${index+1}`} employees={employees} value={row.employeeId} onChange={employeeId=>patchRow(row.key,{employeeId})} onCreate={canRegisterEmployees?()=>setRegisteringFor(row.key):undefined}/></td><td>{employee?.registrationNumber||'—'}</td><td>{employee?.jobTitle||<span className="overtime-missing-role">{employee?'Cadastre o cargo':'—'}</span>}</td><td><OvertimeDurationInput label={`Horas extras 50% da linha ${index+1}`} value={row.hours50} onChange={value=>patchRow(row.key,{hours50:value})} onComplete={()=>inputs100.current.get(row.key)?.focus()}/></td><td><OvertimeDurationInput label={`Horas extras 100% da linha ${index+1}`} value={row.hours100} onChange={value=>patchRow(row.key,{hours100:value})} inputRef={node=>{if(node)inputs100.current.set(row.key,node);else inputs100.current.delete(row.key);}}/></td><td><button type="button" className="icon-btn overtime-delete" aria-label={`Remover linha ${index+1}`} onClick={()=>void remove(row)}><Trash2 size={16}/></button></td></tr>;
   })}</tbody></table></div>
   <button type="button" className="btn overtime-add-row" onClick={()=>setRows(current=>[...current,{key:crypto.randomUUID(),employeeId:'',hours50:'',hours100:''}])} disabled={rows.length>=500}><Plus size={16}/>Adicionar funcionário</button>
  </fieldset>
  <section className="overtime-draft-summary" aria-label="Resumo das horas extras" aria-busy={totals.updating}><h3>Resumo do relatório</h3><div><span>Total de horas 50%</span><output aria-label="Total de horas 50%">{totals.updating?'Calculando…':totals.data?.total50??'—'}</output></div><div><span>Total de horas 100%</span><output aria-label="Total de horas 100%">{totals.updating?'Calculando…':totals.data?.total100??'—'}</output></div>{!totals.updating&&totals.error&&<p className="form-error" role="alert">{totals.error}</p>}</section>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="overtime-auto-save-status" role="status">{autosave.status==='saving'?<><Loader2 className="animate-spin" size={14}/>Salvando automaticamente…</>:autosave.status==='error'?'Não foi possível salvar. Confira a mensagem acima.':'Alterações salvas automaticamente.'}</div>
 </form>{registeringFor!==null&&<EmployeeForm requireJobTitle onClose={()=>setRegisteringFor(null)} onSave={async input=>{
  const employee=await employeeMutations.save(input);if(!mounted.current)return employee;
  if(registeringFor==='new')setRows(current=>[...current,{key:crypto.randomUUID(),employeeId:employee.id,hours50:'',hours100:''}]);
  else patchRow(registeringFor,{employeeId:employee.id});
  setRegisteringFor(null);notifications.created('O funcionário foi cadastrado e selecionado neste relatório.');return employee;
 }}/>}</>;
}
