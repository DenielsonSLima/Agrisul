import Link from 'next/link';
import {useState} from 'react';
import {Plus,LandPlot,Pencil,Loader2,RefreshCw} from 'lucide-react';
import {notifications} from '@/shared/feedback';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Progress} from '@/components/ui/progress';
import {formatHectares} from '@/modules/cadastro/fazenda/utils/farmFormat';
import {usePlots} from '../hooks/usePlots';
import {PlotForm} from '../forms/PlotForm';
import {PlotBreadcrumb} from './PlotBreadcrumb';
import type {Plot} from '../types';
export function FarmPlotsPage({farmId}:{farmId:string}){
  const m=usePlots(farmId);const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [edit,setEdit]=useState<Plot>();
  const begin=(plot?:Plot)=>{setEdit(plot);setBusy(false);setOpen(true);};
  if(m.loading||m.error||!m.data)return <section><PlotBreadcrumb farmName="Fazenda"/>{m.loading?<div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando talhões…</div>:<div className="company-empty" role="alert"><h3>{m.status===404?'Fazenda não encontrada':'Não foi possível carregar'}</h3><p>{m.error}</p>{m.status===401?<Link className="btn company-primary" href={'/login?returnTo='+encodeURIComponent('/cadastro?secao=fazenda&fazenda='+farmId)} target="_top">Entrar</Link>:m.status!==404&&<button className="btn" onClick={m.reload}><RefreshCw size={16}/>Tentar novamente</button>}</div>}</section>;
  const {farm,plots,totalHa,usedHa,availableHa,usedPercent,canAddPlot}=m.data;const maximum=plots.find(plot=>plot.id===edit?.id)?.maxAreaHa??availableHa;
  return <section className="plots-workspace"><PlotBreadcrumb farmName={farm.name}/><div className="companies-heading client-detail-heading"><div><h2>{farm.name}</h2><p>{farm.city} / {farm.state} · Talhões</p></div><button className="btn company-primary" disabled={!canAddPlot} onClick={()=>begin()}><Plus size={17}/>Cadastrar talhão</button></div>
    <div className="plot-area-summary"><div><span>Área da fazenda</span><strong>{formatHectares(totalHa)} <small>ha</small></strong></div><div><span>Área em talhões</span><strong>{formatHectares(usedHa)} <small>ha</small></strong></div><div className="plot-area-free"><span>Área disponível</span><strong>{formatHectares(availableHa)} <small>ha</small></strong></div><Progress value={usedPercent} aria-label="Área da fazenda distribuída em talhões" className="plot-area-progress"/></div>
    {!canAddPlot&&<p className="plot-full-note">Toda a área da fazenda está distribuída. Você pode editar os talhões existentes.</p>}
    {!plots.length?<div className="company-empty"><span className="company-empty-icon"><LandPlot size={25}/></span><h3>Cadastre o primeiro talhão</h3><p>Distribua os {formatHectares(totalHa)} ha da fazenda entre os talhões.</p><button className="btn company-primary" onClick={()=>begin()}><Plus size={16}/>Cadastrar talhão</button></div>:<><p className="farm-count">{plots.length} talh{plots.length===1?'ão':'ões'}</p><div className="farm-grid">{plots.map(plot=><button className="farm-card plot-card" type="button" key={plot.id} onClick={()=>begin(plot)} aria-label={'Editar '+plot.name}><span className="farm-card-top"><span className="farm-card-icon"><LandPlot size={20}/></span><Pencil size={14}/></span><span className="farm-card-name" title={plot.name}>{plot.name}</span><span className="farm-card-area"><strong>{formatHectares(plot.areaHa)}</strong><span>ha</span></span></button>)}</div></>}
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="form-modal farm-modal" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}><DialogHeader><DialogTitle>{edit?'Editar talhão':'Cadastrar talhão'}</DialogTitle><DialogDescription>{farm.name}</DialogDescription></DialogHeader><PlotForm plot={edit} maxAreaHa={maximum} onBusy={setBusy} onClose={()=>{setBusy(false);setOpen(false);}} onSave={async(input,id)=>{await m.save(input,id);if(id)notifications.updated('O talhão foi atualizado.');else notifications.created('O talhão foi cadastrado.');}}/></DialogContent></Dialog>
  </section>;
}
