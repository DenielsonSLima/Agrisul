import {agendaKinds,type AgendaKind} from '../types';
export function AgendaLegend({kind,onKind}:{kind:AgendaKind|'';onKind:(value:AgendaKind|'')=>void}){
 return <section className="agenda-legend-panel"><h3>Legenda</h3><p>Selecione um tipo para filtrar o calendário.</p><div className="agenda-legend" aria-label="Legenda e filtros da agenda"><button aria-pressed={!kind} onClick={()=>onKind('')}>Todos os eventos</button>{agendaKinds.map(item=><button key={item.id} aria-pressed={kind===item.id} onClick={()=>onKind(kind===item.id?'':item.id)}><i className={`agenda-dot agenda-${item.id}`}/>{item.label}</button>)}</div></section>;
}
