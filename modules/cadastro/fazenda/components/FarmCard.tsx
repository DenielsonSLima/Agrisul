import {ArrowUpRight,LandPlot,MapPin,Pencil,ShieldCheck,Tractor} from 'lucide-react';
import {formatHectares} from '../utils/farmFormat';
import type {FarmSummary} from '../types';

export function FarmCard({farm,onOpen,onEdit}:{farm:FarmSummary;onOpen:()=>void;onEdit:()=>void}){
 return <article className="farm-card farm-summary-card">
  <div className="farm-card-top">
   <span className="farm-card-icon"><Tractor size={20} strokeWidth={1.6}/></span>
   <button type="button" className="farm-card-edit" onClick={onEdit} aria-label={'Editar fazenda '+farm.name}><Pencil size={15}/></button>
  </div>
  <button type="button" className="farm-card-open" onClick={onOpen} aria-label={'Abrir talhões da fazenda '+farm.name}>
   <span className="farm-card-title-row"><span className="farm-card-name" title={farm.name}>{farm.name}</span><ArrowUpRight size={16}/></span>
   <span className="farm-card-metrics">
    <span><small>Área total</small><strong>{formatHectares(farm.totalHa)} <em>ha</em></strong></span>
    <span><small>Área usada</small><strong>{formatHectares(farm.usedHa)} <em>ha</em></strong></span>
    <span className="preserved"><small>Área preservada</small><strong>{formatHectares(farm.preservedHa)} <em>ha</em></strong></span>
   </span>
   <span className="farm-card-footer-row">
    <span className="farm-card-location"><MapPin size={14}/><span title={farm.city+' / '+farm.state}>{farm.city} / {farm.state}</span></span>
    <span className="farm-card-plots"><LandPlot size={14}/>{farm.plotCount} talh{farm.plotCount===1?'ão':'ões'}</span>
   </span>
   <span className="farm-card-allocation" aria-label={`${farm.usedPercent}% da área utilizada`}><span style={{width:`${Math.min(100,Math.max(0,farm.usedPercent))}%`}}/></span>
   <span className="farm-card-open-label"><ShieldCheck size={14}/>Abrir talhões</span>
  </button>
 </article>;
}
