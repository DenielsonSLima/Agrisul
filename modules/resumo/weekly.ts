import {shiftDay} from './filters';

const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
export function weeklyRange(now=new Date()){
 const parts=calendar.formatToParts(now),part=(type:string)=>parts.find(value=>value.type===type)!.value;
 const to=`${part('year')}-${part('month')}-${part('day')}`;
 return {from:shiftDay(to,-6),to};
}
export const weeklyDate=(date:string)=>date.split('-').reverse().slice(0,2).join('/');
