'use client';
import {useId,useRef,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight,Clock3,Plus,RotateCcw,Trash2} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {dateLabel} from '@/shared/utils/presentation';
import type {OvertimeDailyEntry} from '../types';
import {OvertimeDurationInput} from './OvertimeDurationInput';

const hasValues=(entry:OvertimeDailyEntry)=>!!(entry.startTime||entry.endTime||entry.breakStart||entry.breakEnd||entry.reason||entry.approval||(entry.breakDuration&&entry.breakDuration!=='00:00:00'));
const entryValues=({id,date,startTime,breakStart,breakEnd,breakDuration,endTime,rate,reason,approval}:OvertimeDailyEntry)=>({id,date,startTime,breakStart,breakEnd,breakDuration:breakStart||breakEnd?'':breakDuration,endTime,rate,reason,approval});
const weekdayFormatter=new Intl.DateTimeFormat('pt-BR',{weekday:'long',timeZone:'UTC'});
const weekday=(date:string)=>weekdayFormatter.format(new Date(date+'T12:00:00Z'));
type Props={dates:string[];entries:OvertimeDailyEntry[];savedEntries:OvertimeDailyEntry[];readOnly:boolean;busy:boolean;onPatch:(id:string,value:Partial<OvertimeDailyEntry>)=>void;onAdd:(date:string,rate:'50'|'100')=>void;onRemove:(entry:OvertimeDailyEntry)=>void;onClear:(date:string)=>void};

export function OvertimeDailySchedule({dates,entries,savedEntries,readOnly,busy,onPatch,onAdd,onRemove,onClear}:Props){
 const [activeDate,setActiveDate]=useState(()=>entries.find(hasValues)?.date??dates[0]);
 const [showCalendar,setShowCalendar]=useState(false),calendarId=useId();
 const periodList=useRef<HTMLDivElement>(null);
 const date=dates.includes(activeDate)?activeDate:dates[0],index=dates.indexOf(date);
 const periods:OvertimeDailyEntry[]=[],filledDates=new Set<string>(),byDate=new Map<string,ReturnType<typeof entryValues>[]>();
 for(const entry of entries){if(entry.date===date)periods.push(entry);if(hasValues(entry)){filledDates.add(entry.date);const grouped=byDate.get(entry.date)??[];grouped.push(entryValues(entry));byDate.set(entry.date,grouped);}}
 const savedById=new Map<string|undefined,OvertimeDailyEntry>(),savedByDate=new Map<string,ReturnType<typeof entryValues>[]>();
 for(const entry of savedEntries){savedById.set(entry.id,entry);const grouped=savedByDate.get(entry.date)??[];grouped.push(entryValues(entry));savedByDate.set(entry.date,grouped);}
 const pending=(day:string)=>JSON.stringify(byDate.get(day)??[])!==JSON.stringify(savedByDate.get(day)??[]);
 const canAdd=!readOnly&&periods.length<8;
 const addPeriod=(rate:'50'|'100')=>{onAdd(date,rate);requestAnimationFrame(()=>{const input=periodList.current?.lastElementChild?.querySelector<HTMLInputElement>('input[type=time]');input?.focus({preventScroll:true});input?.scrollIntoView({block:'center',behavior:'instant'});});};
 return <section className="overtime-daily-schedule" aria-label="Dias e períodos de horas extras">
  <aside className="overtime-day-navigation" aria-label="Navegação entre dias">
   <div className="overtime-day-nav-title"><span><CalendarDays size={17}/>Dias do período</span><small>{index+1} de {dates.length}</small></div>
   <div className="overtime-day-controls"><button type="button" className="btn icon-btn" aria-label="Dia anterior" disabled={busy||index<=0} onClick={()=>setActiveDate(dates[index-1])}><ChevronLeft size={19}/></button><label className="overtime-day-picker"><span className="sr-only">Dia dos lançamentos</span><select aria-label="Dia dos lançamentos" value={date} disabled={busy} onChange={event=>setActiveDate(event.target.value)}>{dates.map(day=><option key={day} value={day}>{dateLabel(day)} · {weekday(day)}{filledDates.has(day)?' · Com lançamento':''}</option>)}</select></label><button type="button" className="btn icon-btn" aria-label="Próximo dia" disabled={busy||index===dates.length-1} onClick={()=>setActiveDate(dates[index+1])}><ChevronRight size={19}/></button></div>
   <button className="overtime-calendar-toggle" type="button" aria-expanded={showCalendar} aria-controls={calendarId} onClick={()=>setShowCalendar(value=>!value)}>{showCalendar?'Recolher dias':'Ver dias do período'}<CalendarDays size={16}/></button>
   <div id={calendarId} className={'overtime-day-calendar'+(showCalendar?' is-expanded':'')}><div className="overtime-day-grid">{dates.map(day=><button key={day} type="button" className={day===date?'is-active':''} aria-current={day===date?'date':undefined} aria-label={dateLabel(day)+(pending(day)?', alterações pendentes':filledDates.has(day)?', com lançamento':', sem lançamento')} disabled={busy} onClick={()=>setActiveDate(day)}><span>{day.slice(8)}/{day.slice(5,7)}</span><i className={pending(day)?'is-pending':filledDates.has(day)?'is-saved':''}/></button>)}</div><p className="overtime-calendar-legend"><span><i className="is-saved"/>Com lançamento</span><span><i className="is-pending"/>Pendente de salvar</span></p></div>
  </aside>
  <div className="overtime-day-workspace" data-date={date}>
   <header className="overtime-day-heading"><div><span className="eyebrow">LANÇAMENTOS DO DIA</span><h3>{dateLabel(date)} <span>{weekday(date)}</span></h3><p>Adicione um período para cada horário e faixa de hora extra.</p></div>{!readOnly&&<button className="btn small overtime-delete" type="button" disabled={busy||!filledDates.has(date)} onClick={()=>onClear(date)}><RotateCcw size={15}/>Limpar dia</button>}</header>
   <div className="overtime-period-list" ref={periodList}>{periods.map((entry,periodIndex)=>{
    const number=periodIndex+1,label=(name:string)=>`${name} de ${dateLabel(date)}, período ${number}`;
    const original=savedById.get(entry.id),changed=JSON.stringify(entryValues(entry))!==JSON.stringify(original?entryValues(original):undefined);
    return <article className="overtime-period-card" key={entry.id} data-period-id={entry.id} aria-label={'Período '+number+' de '+dateLabel(date)}>
     <div className="overtime-period-heading"><h4><Clock3 size={16}/>Período {number}</h4><span className={'overtime-rate-badge rate-'+entry.rate}>{entry.rate}%</span>{!readOnly&&<button className="icon-btn overtime-delete" type="button" aria-label={'Remover período '+number+' de '+dateLabel(date)} disabled={busy||(!hasValues(entry)&&periods.length===1)} onClick={()=>onRemove(entry)}><Trash2 size={17}/></button>}</div>
     <fieldset disabled={readOnly||busy}>
      <div className="overtime-period-main-fields"><Field label="Hora inicial"><input type="time" step={1} aria-label={label('Inicial')} value={entry.startTime} onChange={event=>onPatch(entry.id!,{startTime:event.target.value})}/></Field><Field label="Hora final"><input type="time" step={1} aria-label={label('Final')} value={entry.endTime} onChange={event=>onPatch(entry.id!,{endTime:event.target.value})}/></Field><Field label="Faixa da hora extra"><select aria-label={label('Tipo de hora extra')} value={entry.rate} onChange={event=>onPatch(entry.id!,{rate:event.target.value as '50'|'100'})}><option value="50">50%</option><option value="100">100%</option></select></Field></div>
      <details className="overtime-period-break" key={'break-'+entry.id} open={entry.breakStart||entry.breakEnd||entry.breakDuration!=='00:00:00'?true:undefined}><summary>Intervalo neste período <span>Opcional</span></summary><div className="overtime-period-break-fields"><Field label="Saída para intervalo"><input type="time" step={1} aria-label={label('Saída intervalo')} value={entry.breakStart} onChange={event=>onPatch(entry.id!,{breakStart:event.target.value})}/></Field><Field label="Retorno do intervalo"><input type="time" step={1} aria-label={label('Retorno')} value={entry.breakEnd} onChange={event=>onPatch(entry.id!,{breakEnd:event.target.value})}/></Field><Field label="Duração a descontar">{entry.breakStart||entry.breakEnd?<p className="overtime-break-from-times">Calculado pelos horários</p>:<OvertimeDurationInput label={label('Intervalo a descontar')} value={entry.breakDuration} onChange={breakDuration=>onPatch(entry.id!,{breakDuration})}/>}</Field></div><p>Informe os horários ou a duração. Sem intervalo, mantenha 00:00:00.</p></details>
      <div className="overtime-period-notes"><Field label="Motivo da hora extra"><textarea rows={2} aria-label={label('Motivo')} maxLength={500} value={entry.reason} onChange={event=>onPatch(entry.id!,{reason:event.target.value})}/></Field><Field label="Visto"><input aria-label={label('Visto')} maxLength={120} value={entry.approval} onChange={event=>onPatch(entry.id!,{approval:event.target.value})}/></Field></div>
     </fieldset>
     <p className="overtime-period-saved"><span>Total salvo · {entry.rate}%</span><strong>{changed&&hasValues(entry)?'Salvar para calcular':entry.rate==='100'?entry.hours100||'—':entry.hours50||'—'}</strong></p>
    </article>;
   })}</div>
   {!readOnly&&<div className="overtime-add-period"><button type="button" className="btn" disabled={busy||!canAdd} onClick={()=>addPeriod('50')}><Plus size={17}/>Adicionar período 50%</button><button type="button" className="btn" disabled={busy||!canAdd} onClick={()=>addPeriod('100')}><Plus size={17}/>Adicionar período 100%</button><p>{canAdd?'No mesmo dia, lance 50% e 100% em períodos separados, sem sobrepor horários.':'Limite de 8 períodos por dia.'}</p></div>}
  </div>
 </section>;
}
