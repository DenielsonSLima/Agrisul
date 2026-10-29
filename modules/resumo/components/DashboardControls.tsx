'use client';
import {useEffect,useRef,useSyncExternalStore,type ReactNode} from 'react';
import {Building2,ChartNoAxesCombined,ChevronLeft,ChevronRight,Layers3,LayoutDashboard,FileChartColumn,Settings2,X} from 'lucide-react';
import {notifications} from '@/shared/feedback';
import {DASHBOARD_SCENES,PRESENTATION_INTERVALS,useDashboardPresentation} from '../hooks/useDashboardPresentation';

export type Presentation=ReturnType<typeof useDashboardPresentation>;
const sceneIcons=[LayoutDashboard,ChartNoAxesCombined,Building2,FileChartColumn,Layers3];
const clockTime=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const clockDate=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'});
const clockCalendar=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'short',year:'numeric'});
const clockSnapshot=()=>Math.floor(Date.now()/1000)*1000;
const clockServerSnapshot=()=>null;
function subscribeClock(changed:()=>void){
 const timer=setInterval(changed,1000);
 return()=>clearInterval(timer);
}

export function DashboardSceneNavigation({presentation}:{presentation:Presentation}){
 const p=presentation;
 const focusTab=(index:number)=>{p.selectScene(index);document.getElementById(`tab-${DASHBOARD_SCENES[index].id}`)?.focus();};
 return <div className="executive-navigation">
  <div className="executive-tabs" role="tablist" aria-label="Visões do Dashboard" onKeyDown={event=>{
   let next:number|undefined;
   if(event.key==='ArrowRight')next=(p.scene+1)%DASHBOARD_SCENES.length;
   if(event.key==='ArrowLeft')next=(p.scene+DASHBOARD_SCENES.length-1)%DASHBOARD_SCENES.length;
   if(event.key==='Home')next=0;if(event.key==='End')next=DASHBOARD_SCENES.length-1;
   if(next!==undefined){event.preventDefault();focusTab(next);}
  }}>{DASHBOARD_SCENES.map((scene,index)=>{const Icon=sceneIcons[index];return <button key={scene.id} id={`tab-${scene.id}`} type="button" role="tab" aria-selected={p.scene===index} aria-controls={scene.id} tabIndex={p.scene===index?0:-1} onClick={()=>p.selectScene(index)}><Icon size={17}/><span>{scene.label}</span></button>;})}</div>
  <div className="executive-page-controls"><span>{String(p.scene+1).padStart(2,'0')} <i>/ {String(DASHBOARD_SCENES.length).padStart(2,'0')}</i></span><button type="button" aria-label="Painel anterior" onClick={()=>p.selectScene((p.scene+DASHBOARD_SCENES.length-1)%DASHBOARD_SCENES.length)}><ChevronLeft size={16}/></button><button type="button" aria-label="Próximo painel" onClick={()=>p.selectScene((p.scene+1)%DASHBOARD_SCENES.length)}><ChevronRight size={16}/></button></div>
 </div>;
}

export function DashboardSettings({presentation,open,onToggle,onClose}:{presentation:Presentation;open:boolean;onToggle:()=>void;onClose:()=>void}){
 const trigger=useRef<HTMLButtonElement>(null);
 const commonMinutes=DASHBOARD_SCENES.every(scene=>presentation.minutesByScene[scene.id]===presentation.minutesByScene[DASHBOARD_SCENES[0].id])?presentation.minutesByScene[DASHBOARD_SCENES[0].id]:'';
 const feedback=(saved:boolean)=>saved?notifications.saved('Tempos de apresentação salvos neste navegador.'):notifications.error('Não foi possível salvar os tempos neste navegador.');
 return <div className="executive-settings-anchor"><button ref={trigger} className="executive-settings-trigger" type="button" aria-label="Configurações do Dashboard" aria-expanded={open} aria-controls="dashboard-settings" onClick={onToggle}><Settings2 size={18}/></button>
  {open&&<DashboardPopover title="Configurações do Dashboard" id="dashboard-settings" onClose={onClose} onReturnFocus={()=>trigger.current?.focus({preventScroll:true})} settings>
   <p className="executive-setting-caption">Defina quanto tempo cada aba permanece na tela durante a apresentação.</p>
   <label className="executive-setting-field">Aplicar o mesmo tempo às cinco abas<select aria-label="Intervalo de troca dos painéis" value={commonMinutes} onChange={event=>feedback(presentation.setMinutes(Number(event.target.value)))}><option value="" disabled>Personalizado por aba</option>{PRESENTATION_INTERVALS.map(minutes=><option key={minutes} value={minutes}>{minutes} {minutes===1?'minuto':'minutos'}</option>)}</select></label>
   <fieldset className="executive-duration-list"><legend>Tempo por aba</legend>{DASHBOARD_SCENES.map((scene,index)=><label className="executive-duration-row" key={scene.id} htmlFor={`duration-${scene.id}`}><span>{scene.label}</span><select id={`duration-${scene.id}`} aria-label={`Tempo da aba ${scene.label}`} value={presentation.minutesByScene[scene.id]} onChange={event=>feedback(presentation.setSceneMinutes(index,Number(event.target.value)))}>{PRESENTATION_INTERVALS.map(minutes=><option key={minutes} value={minutes}>{minutes} {minutes===1?'minuto':'minutos'}</option>)}</select></label>)}</fieldset>
   {presentation.settingsError&&<p className="executive-settings-error" role="alert">{presentation.settingsError}</p>}
   <p className="executive-setting-note">As alterações são aplicadas imediatamente e salvas neste navegador. Esc encerra a tela cheia.</p>
  </DashboardPopover>}
 </div>;
}

export function DashboardPopover({title,id,children,onClose,onReturnFocus,settings=false}:{title:string;id:string;children:ReactNode;onClose:()=>void;onReturnFocus?:()=>void;settings?:boolean}){
 const panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const firstField=panel.current?.querySelector<HTMLElement>('select,input')??panel.current?.querySelector<HTMLElement>('button');
  firstField?.focus({preventScroll:true});
  const outside=(event:PointerEvent)=>{if(panel.current?.parentElement&&!panel.current.parentElement.contains(event.target as Node))onClose();};
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[onClose]);
 const close=()=>{onClose();onReturnFocus?.();};
 return <div ref={panel} id={id} role="dialog" aria-label={title} data-dashboard-settings={settings?'true':undefined} className="executive-popover" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}><header><strong>{title}</strong><button type="button" aria-label={`Fechar ${title}`} onClick={close}><X size={17}/></button></header>{children}</div>;
}

export function DashboardClock(){
 const timestamp=useSyncExternalStore<number|null>(subscribeClock,clockSnapshot,clockServerSnapshot);
 const now=timestamp===null?null:new Date(timestamp);
 const time=now?clockTime.format(now):'—:—:—',date=now?clockDate.format(now):'—/—/————';
 const parts=now?clockCalendar.formatToParts(now):[];
 const dayMonth=parts.filter(part=>part.type==='day'||part.type==='month').map(part=>part.value.replace(/\.$/,'')).join(' ')||'— —';
 const year=parts.find(part=>part.type==='year')?.value??'————';
 return <time className="executive-clock" dateTime={now?.toISOString()} title={now?`${date}, horário de Brasília`:'Data e horário de Brasília'} aria-label={now?`${date} às ${time}, horário de Brasília`:'Data e horário de Brasília'}>
  <span className="executive-clock-date" aria-hidden="true"><b>{dayMonth}</b><small>{year}</small></span>
  <strong>{time}</strong>
 </time>;
}
