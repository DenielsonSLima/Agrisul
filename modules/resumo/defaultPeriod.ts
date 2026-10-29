export const DASHBOARD_CALENDAR_PERIODS=[
 {id:'month',label:'Mensal (mês atual)',description:'Do primeiro dia do mês atual até hoje.'},
 {id:'previous-month',label:'Mês anterior',description:'Do primeiro ao último dia do mês anterior.'},
 {id:'last-3-months',label:'Últimos 3 meses',description:'Do primeiro dia de dois meses atrás até hoje, incluindo o mês atual.'},
 {id:'last-6-months',label:'Últimos 6 meses',description:'Do primeiro dia de cinco meses atrás até hoje, incluindo o mês atual.'},
 {id:'last-12-months',label:'Últimos 12 meses',description:'Do primeiro dia de onze meses atrás até hoje, incluindo o mês atual.'},
 {id:'year',label:'Anual (ano atual)',description:'De 1º de janeiro do ano atual até hoje.'},
 {id:'previous-year',label:'Ano anterior',description:'De 1º de janeiro a 31 de dezembro do ano anterior.'},
] as const;
export const DASHBOARD_ROLLING_PERIODS=[
 {id:'last-7-days',label:'Últimos 7 dias',days:7},
 {id:'last-15-days',label:'Últimos 15 dias',days:15},
 {id:'last-30-days',label:'Últimos 30 dias',days:30},
 {id:'last-60-days',label:'Últimos 60 dias',days:60},
 {id:'last-90-days',label:'Últimos 90 dias',days:90},
 {id:'last-180-days',label:'Últimos 180 dias',days:180},
 {id:'last-365-days',label:'Últimos 365 dias',days:365},
] as const;
export const DASHBOARD_DEFAULT_PERIODS=[...DASHBOARD_CALENDAR_PERIODS,...DASHBOARD_ROLLING_PERIODS];
export type DashboardDefaultPeriod=typeof DASHBOARD_DEFAULT_PERIODS[number]['id'];
export const DEFAULT_DASHBOARD_PERIOD:DashboardDefaultPeriod='last-365-days';
export const defaultPeriodKey=(userId:string|null|undefined)=>userId?`billing:dashboard-default-period:v1:${encodeURIComponent(userId)}`:null;
export function readDefaultPeriod(value:string|null|undefined):DashboardDefaultPeriod{return DASHBOARD_DEFAULT_PERIODS.find(item=>item.id===value)?.id??DEFAULT_DASHBOARD_PERIOD;}
export function defaultPeriodDescription(period:DashboardDefaultPeriod){
 return DASHBOARD_CALENDAR_PERIODS.find(item=>item.id===period)?.description??`${DASHBOARD_ROLLING_PERIODS.find(item=>item.id===period)?.days??365} dias corridos, incluindo hoje.`;
}
