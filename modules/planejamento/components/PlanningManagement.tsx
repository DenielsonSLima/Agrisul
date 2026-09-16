import {Leaf} from 'lucide-react';
import {decimalLabel} from '@/shared/utils/presentation';
import type {PlanningAllocation,PlanningFarm} from '../types';

export function PlanningManagement({farms,onManage}:{farms:PlanningFarm[];onManage:(allocation:PlanningAllocation)=>void}){
 const rows=farms.flatMap(farm=>farm.plots.flatMap(plot=>plot.allocation?[{farm,plot,allocation:plot.allocation}]:[]));
 if(!rows.length)return <div className="company-empty"><span className="company-empty-icon"><Leaf size={25}/></span><h3>Distribua áreas primeiro</h3><p>Depois da distribuição, escolha os processos cadastrados em Manejo para cada talhão.</p></div>;
 return <div className="planning-management-list">{rows.map(({farm,plot,allocation})=><article key={allocation.id}><div><span>{farm.name}</span><h3>{plot.name}</h3><p>{decimalLabel(allocation.areaHa)} ha planejados</p></div><div className="planning-management-tags">{allocation.practiceNames.length?allocation.practiceNames.map(name=><span key={name}>{name}</span>):<em>Nenhum manejo selecionado</em>}</div><button className="btn" onClick={()=>onManage(allocation)}><Leaf size={15}/>{allocation.practiceNames.length?'Alterar manejos':'Selecionar manejos'}</button></article>)}</div>;
}
