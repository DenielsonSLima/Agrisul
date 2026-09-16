import {useMemo,useState} from 'react';
import {ArrowRightLeft,Loader2,Save} from 'lucide-react';
import {Checkbox} from '@/components/ui/checkbox';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {formatHectares} from '@/modules/cadastro/fazenda/utils/farmFormat';
import type {PlanningAllocation,PlanningFarm,PlanningPlot,PlanningPractice} from '../types';

const decimal=(value:string)=>Number(value.replace(',','.'))||0;

export function PlantedAreaForm({plot,onSave,onClose}:{plot:PlanningPlot;onSave:(area:string,reason:string)=>Promise<void>;onClose:()=>void}){
 const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 const reserved=decimal(plot.otherPlannedAreaHa)+decimal(plot.allocation?.areaHa??'0');const maximum=Math.max(0,decimal(plot.areaHa)-reserved);
 return <form onSubmit={async event=>{event.preventDefault();const data=new FormData(event.currentTarget);setError('');try{setSaving(true);await onSave(String(data.get('areaHa')??''),String(data.get('reason')??''));onClose();}catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}finally{setSaving(false);}}}>
  <p className="plot-available">Máximo considerando os planos: <strong>{formatHectares(String(maximum))} ha</strong></p><fieldset className="company-fieldset" disabled={saving}><Field label="Área plantada atualmente"><div className="farm-area-input"><input name="areaHa" inputMode="decimal" required defaultValue={plot.plantedAreaHa.replace('.',',')} autoFocus/><span>ha</span></div></Field><Field label="Motivo da atualização"><input name="reason" required minLength={3} maxLength={500} placeholder="Ex.: Levantamento inicial da fazenda"/></Field></fieldset>{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button><button className="btn company-primary" disabled={saving}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>}Salvar área atual</button></div>
 </form>;
}

export function RemanagementForm({allocation,farms,onSave,onClose}:{allocation:PlanningAllocation;farms:PlanningFarm[];onSave:(plotId:string,area:string,reason:string)=>Promise<void>;onClose:()=>void}){
 const options=useMemo(()=>farms.flatMap(farm=>farm.plots.filter(plot=>plot.id!==allocation.plotId).map(plot=>({farm,plot,free:Math.max(0,decimal(plot.maxAllocationAreaHa)-decimal(plot.allocation?.areaHa??'0'))}))).filter(item=>item.free>0),[allocation.plotId,farms]);
 const [target,setTarget]=useState(options[0]?.plot.id??'');const selected=options.find(item=>item.plot.id===target);const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 return <form onSubmit={async event=>{event.preventDefault();const data=new FormData(event.currentTarget);setError('');try{setSaving(true);await onSave(target,String(data.get('areaHa')??''),String(data.get('reason')??''));onClose();}catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}finally{setSaving(false);}}}>
  <fieldset className="company-fieldset" disabled={saving}><Field label="Talhão de destino"><select className="planning-select" value={target} onChange={event=>setTarget(event.target.value)} required><option value="">Selecione</option>{options.map(({farm,plot,free})=><option value={plot.id} key={plot.id}>{farm.name} · {plot.name} · {formatHectares(String(free))} ha livres</option>)}</select></Field><Field label="Área a remanejar"><div className="farm-area-input"><input name="areaHa" inputMode="decimal" required placeholder="Ex.: 5" autoFocus/><span>ha</span></div></Field>{selected&&<p className="planning-form-hint">Origem: até {formatHectares(allocation.areaHa)} ha · Destino: {formatHectares(String(selected.free))} ha livres.</p>}<Field label="Motivo"><input name="reason" required minLength={3} maxLength={500} placeholder="Explique o motivo do remanejamento"/></Field></fieldset>{!options.length&&<p className="form-error" role="alert">Não existe outro talhão com capacidade disponível neste período.</p>}{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button><button className="btn company-primary" disabled={saving||!target||!options.length}>{saving?<Loader2 size={16} className="animate-spin"/>:<ArrowRightLeft size={16}/>}Remanejar</button></div>
 </form>;
}

export function ManagementSelectionForm({allocation,practices,onSave,onClose}:{allocation:PlanningAllocation;practices:PlanningPractice[];onSave:(ids:string[])=>Promise<void>;onClose:()=>void}){
 const [selected,setSelected]=useState(()=>new Set(allocation.practiceIds));const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 const groups=useMemo(()=>Object.entries(Object.groupBy(practices,item=>item.category)),[practices]);
 const toggle=(id:string,checked:boolean)=>setSelected(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
 return <form onSubmit={async event=>{event.preventDefault();setError('');try{setSaving(true);await onSave([...selected]);onClose();}catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}finally{setSaving(false);}}}>
  <fieldset disabled={saving} className="planning-management-fieldset">{groups.map(([category,items])=><section key={category}><h4>{category==='soil-preparation'?'Preparar solo':'Tratos culturais'}</h4><div>{(items??[]).map(item=><label className="planning-practice-option" key={item.id}><Checkbox checked={selected.has(item.id)} onCheckedChange={checked=>toggle(item.id,checked===true)}/><span><strong>{item.name}</strong>{item.description&&<small>{item.description}</small>}</span></label>)}</div></section>)}</fieldset>{!practices.length&&<p className="form-error">Nenhum manejo foi cadastrado para a cultura e o ciclo deste plano.</p>}{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button><button className="btn company-primary" disabled={saving}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>}Salvar manejos</button></div>
 </form>;
}
