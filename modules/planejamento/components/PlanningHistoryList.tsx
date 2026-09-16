import {ArrowRightLeft,Ban,CalendarPlus,ClipboardPlus,History,Leaf,MapPinned,Pencil,Search} from 'lucide-react';
import type {PlanningHistory} from '../types';

const actions={created:'Criado',updated:'Alterado',cancelled:'Cancelado',remanejado:'Remanejado','planted-area':'Área plantada atualizada',management:'Manejos atualizados',logged:'Apontamento diário',voided:'Apontamento anulado'} as const;
const icons={created:CalendarPlus,updated:Pencil,cancelled:History,remanejado:ArrowRightLeft,'planted-area':MapPinned,management:Leaf,logged:ClipboardPlus,voided:Ban} as const;

export function PlanningHistoryList({history,hasHistory}:{history:PlanningHistory[];hasHistory:boolean}){
 if(!history.length)return hasHistory?<div className="company-empty"><span className="company-empty-icon"><Search size={25}/></span><h3>Nenhum evento encontrado</h3><p>Altere ou limpe o filtro para consultar todo o histórico da safra.</p></div>:<div className="company-empty"><span className="company-empty-icon"><History size={25}/></span><h3>O histórico começará aqui</h3><p>Metas, áreas, trabalhos diários, perdas e remanejamentos serão preservados.</p></div>;
 return <ol className="planning-history">{history.map(item=>{const Icon=icons[item.action];return <li key={item.id}><span className="planning-history-icon"><Icon size={16}/></span><div><span><strong>{actions[item.action]}</strong><time dateTime={item.createdAt}>{new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.createdAt))}</time></span><p>{item.reason||'Alteração registrada pelo sistema.'}</p><small>{item.createdByName||'Usuário do espaço de trabalho'}</small></div></li>;})}</ol>;
}
