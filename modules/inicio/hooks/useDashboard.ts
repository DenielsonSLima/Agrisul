import {useSummary} from '@/modules/resumo/hooks/useSummary';
import {useAgenda} from '@/modules/agenda/hooks/useAgenda';
import {currentMonth,localDay} from '@/shared/utils/presentation';
export function useDashboard(){
 const summary=useSummary(currentMonth());
 const agenda=useAgenda(currentMonth(),'');
 return {...summary,today:agenda.data?.days.find(day=>day.date===localDay())?.events??[]};
}
