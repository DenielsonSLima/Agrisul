'use client';
import {FINANCIAL_GROUPINGS,readFinancialGrouping,type FinancialGrouping} from '../financialGrouping';
import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Building2,CalendarDays,ChartNoAxesCombined,ChevronLeft,ChevronRight,Layers3,LayoutDashboard,FileChartColumn,Newspaper,Save,Settings2,Wallet,X} from 'lucide-react';
import {notifications} from '@/shared/feedback';
import {DASHBOARD_SCENES,PRESENTATION_INTERVALS,useDashboardPresentation} from '../hooks/useDashboardPresentation';
import {formatPresentationInterval,isPresentationMinutes,type DashboardSceneId} from '../presentationSettings';
import {DASHBOARD_CALENDAR_PERIODS,DASHBOARD_ROLLING_PERIODS,defaultPeriodDescription,readDefaultPeriod,type DashboardDefaultPeriod} from '../defaultPeriod';
import {readDashboardNewsScope,type DashboardNewsScope} from '../dashboardValues';
import '../dashboardSettings.css';

export type Presentation=ReturnType<typeof useDashboardPresentation>;
const sceneIcons={'dashboard-general':LayoutDashboard,'dashboard-weekly':CalendarDays,'dashboard-production':ChartNoAxesCombined,'dashboard-financial':Wallet,'dashboard-suppliers':Building2,'dashboard-contracts':FileChartColumn,'dashboard-types':Layers3,'dashboard-news':Newspaper};
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
 const visible=DASHBOARD_SCENES.map((scene,index)=>({...scene,index})).filter(scene=>p.enabledSceneIds.includes(scene.id));
 const current=Math.max(0,visible.findIndex(scene=>scene.index===p.scene));
 const adjacent=(offset:number)=>visible[(current+offset+visible.length)%visible.length]?.index;
 const focusTab=(index:number|undefined)=>{if(index===undefined)return;p.selectScene(index);document.getElementById(`tab-${DASHBOARD_SCENES[index].id}`)?.focus();};
 return <div className="executive-navigation">
  <div className="executive-tabs" role="tablist" aria-label="Visões do Dashboard" onKeyDown={event=>{
   let next:number|undefined;
   if(event.key==='ArrowRight')next=adjacent(1);
   if(event.key==='ArrowLeft')next=adjacent(-1);
   if(event.key==='Home')next=visible[0]?.index;if(event.key==='End')next=visible.at(-1)?.index;
   if(next!==undefined){event.preventDefault();focusTab(next);}
  }}>{visible.map(scene=>{const Icon=sceneIcons[scene.id];return <button key={scene.id} id={`tab-${scene.id}`} type="button" role="tab" aria-selected={p.scene===scene.index} aria-controls={scene.id} tabIndex={p.scene===scene.index?0:-1} onClick={()=>p.selectScene(scene.index)}><Icon size={17}/><span>{scene.label}</span></button>;})}</div>
  <div className="executive-page-controls"><span>{String(current+1).padStart(2,'0')} <i>/ {String(visible.length).padStart(2,'0')}</i></span><button type="button" aria-label="Painel anterior" disabled={visible.length<2} onClick={()=>{const index=adjacent(-1);if(index!==undefined)p.selectScene(index);}}><ChevronLeft size={16}/></button><button type="button" aria-label="Próximo painel" disabled={visible.length<2} onClick={()=>{const index=adjacent(1);if(index!==undefined)p.selectScene(index);}}><ChevronRight size={16}/></button></div>
 </div>;
}

type SettingsProps={presentation:Presentation;open:boolean;onToggle:()=>void;onClose:()=>void;financialGrouping:FinancialGrouping;onFinancialGroupingChange:(value:FinancialGrouping)=>boolean;defaultPeriod:DashboardDefaultPeriod;onDefaultPeriodChange:(value:DashboardDefaultPeriod)=>boolean;newsScope:DashboardNewsScope;onNewsScopeChange:(value:DashboardNewsScope)=>boolean};
const SETTINGS_TABS=[{id:'general',label:'Geral',Icon:LayoutDashboard},{id:'tabs',label:'Abas do dashboard',Icon:Layers3},{id:'presentation',label:'Apresentação',Icon:CalendarDays},{id:'news',label:'Notícias',Icon:Newspaper}] as const;
type SettingsTab=typeof SETTINGS_TABS[number]['id'];

export function DashboardSettings(props:SettingsProps){
 const trigger=useRef<HTMLButtonElement>(null);
 return <div className="executive-settings-anchor"><button ref={trigger} className="executive-settings-trigger" type="button" aria-label="Configurações do Dashboard" aria-expanded={props.open} aria-controls="dashboard-settings" onClick={props.onToggle}><Settings2 size={18}/></button>
  {props.open&&<DashboardSettingsModal {...props} onReturnFocus={()=>trigger.current?.focus({preventScroll:true})}/>}
 </div>;
}

function DashboardSettingsModal({presentation,onClose,onReturnFocus,financialGrouping,onFinancialGroupingChange,defaultPeriod,onDefaultPeriodChange,newsScope,onNewsScopeChange}:SettingsProps&{onReturnFocus:()=>void}){
 const panel=useRef<HTMLDivElement>(null),returnFocusRef=useRef(onReturnFocus);
 const [tab,setTab]=useState<SettingsTab>('general');
 const [period,setPeriod]=useState(defaultPeriod),[grouping,setGrouping]=useState(financialGrouping),[scope,setScope]=useState(newsScope);
 const [minutes,setMinutes]=useState(()=>({...presentation.minutesByScene}));
 const [enabled,setEnabled]=useState<DashboardSceneId[]>(()=>[...presentation.enabledSceneIds]);
 const [error,setError]=useState(''),[saving,setSaving]=useState(false);
 const commonMinutes=DASHBOARD_SCENES.every(scene=>minutes[scene.id]===minutes[DASHBOARD_SCENES[0].id])?minutes[DASHBOARD_SCENES[0].id]:'';
 useEffect(()=>{
  const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
  const modal=panel.current,restoreFocus=returnFocusRef.current;
  modal?.querySelector<HTMLElement>('button')?.focus({preventScroll:true});
  const retainFocus=(event:FocusEvent)=>{if(modal&&!modal.contains(event.target as Node))modal.querySelector<HTMLElement>('button')?.focus({preventScroll:true});};
  document.addEventListener('focusin',retainFocus);
  return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('focusin',retainFocus);restoreFocus();};
 },[]);
 const close=()=>{if(!saving)onClose();};
 const setSceneEnabled=(id:DashboardSceneId,checked:boolean)=>{setEnabled(previous=>checked?[...previous,id]:previous.filter(value=>value!==id));setError('');};
 const save=()=>{
  if(saving)return;
  if(!enabled.length){setTab('tabs');setError('Mantenha pelo menos uma aba ativa no dashboard.');notifications.error('Ative pelo menos uma aba antes de salvar.');return;}
  setSaving(true);setError('');
  try{
   const results=[presentation.savePreferences({minutesByScene:minutes,enabledSceneIds:enabled}),onDefaultPeriodChange(period),onFinancialGroupingChange(grouping),onNewsScopeChange(scope)];
   if(results.every(Boolean)){notifications.saved('Configurações do Dashboard salvas neste navegador.');onClose();}
   else{setError('As configurações foram aplicadas nesta sessão, mas o navegador não permitiu salvar todas as preferências.');notifications.error('Não foi possível salvar todas as configurações neste navegador.');}
  }catch{setError('Não foi possível salvar as configurações. Tente novamente.');notifications.error('Não foi possível salvar as configurações do Dashboard.');}
  finally{setSaving(false);}
 };
 const content=<div className="dashboard-settings-backdrop"><div ref={panel} id="dashboard-settings" className="dashboard-settings-modal" data-dashboard-settings="true" role="dialog" aria-modal="true" aria-labelledby="dashboard-settings-title" aria-describedby="dashboard-settings-description" aria-busy={saving} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key!=='Tab')return;
  const fields=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href],[tabindex]')??[]).filter(field=>field.tabIndex>=0&&field.getClientRects().length>0);
  if(!fields?.length)return;const first=fields[0],last=fields[fields.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 }}>
  <header className="dashboard-settings-header"><div><span>PERSONALIZE SEU PAINEL</span><h2 id="dashboard-settings-title">Configurações do Dashboard</h2><p id="dashboard-settings-description">Organize as abas, ajuste a apresentação e escolha o conteúdo que deseja acompanhar.</p></div><button type="button" className="dashboard-settings-close" aria-label="Fechar Configurações do Dashboard" disabled={saving} onClick={close}><X size={22}/></button></header>
  <div className="dashboard-settings-layout"><nav className="dashboard-settings-tabs" role="tablist" aria-label="Categorias das configurações" aria-orientation="vertical" onKeyDown={event=>{
   const index=SETTINGS_TABS.findIndex(item=>item.id===tab);let next:number|undefined;
   if(event.key==='ArrowDown'||event.key==='ArrowRight')next=(index+1)%SETTINGS_TABS.length;
   if(event.key==='ArrowUp'||event.key==='ArrowLeft')next=(index+SETTINGS_TABS.length-1)%SETTINGS_TABS.length;
   if(event.key==='Home')next=0;if(event.key==='End')next=SETTINGS_TABS.length-1;
   if(next!==undefined){event.preventDefault();const id=SETTINGS_TABS[next].id;setTab(id);document.getElementById(`dashboard-settings-tab-${id}`)?.focus();}
  }}>{SETTINGS_TABS.map(({id,label,Icon})=><button type="button" key={id} role="tab" id={`dashboard-settings-tab-${id}`} aria-selected={tab===id} aria-controls={`dashboard-settings-panel-${id}`} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)}><Icon size={19}/><span>{label}</span><ChevronRight size={15}/></button>)}</nav>
   <div className="dashboard-settings-content" role="tabpanel" id={`dashboard-settings-panel-${tab}`} aria-labelledby={`dashboard-settings-tab-${tab}`} tabIndex={0}>
    {tab==='general'&&<><h3>Preferências gerais</h3><p className="dashboard-settings-intro">Defina como o dashboard abre e como os gráficos organizam o período.</p><label className="dashboard-settings-field">Período padrão do Dashboard<select aria-label="Período padrão do Dashboard" aria-describedby="dashboard-default-period-caption" value={period} onChange={event=>setPeriod(readDefaultPeriod(event.target.value))}><optgroup label="Meses e anos do calendário">{DASHBOARD_CALENDAR_PERIODS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</optgroup><optgroup label="Dias corridos">{DASHBOARD_ROLLING_PERIODS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</optgroup></select></label><p id="dashboard-default-period-caption" className="dashboard-settings-help">{defaultPeriodDescription(period)} Aplicado ao abrir o Dashboard e ao limpar filtros. Salvar também atualiza o período exibido.</p><label className="dashboard-settings-field">Agrupamento dos gráficos<select aria-label="Agrupamento dos gráficos" value={grouping} onChange={event=>setGrouping(readFinancialGrouping(event.target.value))}>{FINANCIAL_GROUPINGS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><p className="dashboard-settings-help">Semanas de segunda a domingo. Quinzenas: 1 a 15 e 16 ao fim do mês. A aba Semanal usa sete dias e evolução diária.</p></>}
    {tab==='tabs'&&<><h3>Abas do dashboard</h3><p className="dashboard-settings-intro">Escolha quais abas aparecem na navegação e participam da apresentação automática. Mantenha pelo menos uma ativa.</p><div className="dashboard-settings-options">{DASHBOARD_SCENES.map(scene=>{const Icon=sceneIcons[scene.id];return <label key={scene.id} className="dashboard-settings-toggle"><span className="dashboard-settings-option-icon"><Icon size={20}/></span><span><strong>{scene.label}</strong><small>{enabled.includes(scene.id)?'Visível no dashboard':'Oculta no dashboard'}</small></span><input type="checkbox" role="switch" aria-label={`Ativar aba ${scene.label}`} checked={enabled.includes(scene.id)} onChange={event=>setSceneEnabled(scene.id,event.target.checked)}/></label>;})}</div></>}
    {tab==='presentation'&&<><h3>Apresentação</h3><p className="dashboard-settings-intro">Controle o tempo de permanência de cada aba durante a apresentação do dashboard.</p><label className="dashboard-settings-field">Aplicar o mesmo tempo a todas as abas<select aria-label="Intervalo de troca dos painéis" value={commonMinutes} onChange={event=>{const value=Number(event.target.value);if(isPresentationMinutes(value))setMinutes(Object.fromEntries(DASHBOARD_SCENES.map(scene=>[scene.id,value])) as typeof minutes);}}><option value="" disabled>Personalizado por aba</option>{PRESENTATION_INTERVALS.map(value=><option key={value} value={value}>{formatPresentationInterval(value)}</option>)}</select></label><fieldset className="dashboard-settings-durations"><legend>Tempo por aba</legend>{DASHBOARD_SCENES.map(scene=><label key={scene.id} htmlFor={`duration-${scene.id}`}><span>{scene.label}{!enabled.includes(scene.id)&&<small>Aba desativada</small>}</span><select id={`duration-${scene.id}`} aria-label={`Tempo da aba ${scene.label}`} value={minutes[scene.id]} onChange={event=>{const value=Number(event.target.value);if(isPresentationMinutes(value))setMinutes(previous=>({...previous,[scene.id]:value}));}}>{PRESENTATION_INTERVALS.map(value=><option key={value} value={value}>{formatPresentationInterval(value)}</option>)}</select></label>)}</fieldset></>}
    {tab==='news'&&<><h3>Notícias</h3><p className="dashboard-settings-intro">Escolha os assuntos exibidos nos painéis de notícias.</p><label className="dashboard-settings-field">Notícias do Dashboard<select aria-label="Notícias do Dashboard" aria-describedby="dashboard-news-scope-caption" value={scope} onChange={event=>setScope(readDashboardNewsScope(event.target.value))}><option value="all">Visão geral</option><option value="cane">Só cana</option></select></label><p id="dashboard-news-scope-caption" className="dashboard-settings-help">Visão geral inclui cana, soja, milho e agronegócio. Só cana exibe notícias de cana, açúcar e etanol em todos os painéis de notícias.</p></>}
    {error&&<p className="dashboard-settings-error" role="alert">{error}</p>}
   </div>
  </div>
  <footer className="dashboard-settings-footer"><p>As alterações são aplicadas ao salvar e ficam vinculadas à sua conta neste navegador.</p><div><button className="dashboard-settings-cancel" type="button" disabled={saving} onClick={close}>Cancelar</button><button className="dashboard-settings-save" type="button" disabled={saving} onClick={save}><Save size={17}/>{saving?'Salvando…':'Salvar configurações'}</button></div></footer>
 </div></div>;
 return createPortal(content,document.fullscreenElement??document.body);
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
  <strong><small aria-hidden="true">H</small><span>{time}</span></strong>
  <span className="executive-clock-date" aria-hidden="true"><b>{dayMonth}</b><small>{year}</small></span>
 </time>;
}
