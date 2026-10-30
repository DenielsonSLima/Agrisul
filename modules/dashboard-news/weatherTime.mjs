const clock=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function weatherClock(at=Date.now()){
 const parts=Object.fromEntries(clock.formatToParts(new Date(at)).map(part=>[part.type,part.value]));
 const hour=Number(parts.hour),minute=Number(parts.minute),second=Number(parts.second);
 return {date:`${parts.year}-${parts.month}-${parts.day}`,hour,minute,second,period:hour<12?'manha':hour<18?'tarde':'noite'};
}
export function weatherSolarTime(value){
 const match=typeof value==='string'&&value.match(/^(\d{2})[:h](\d{2})$/);
 return match&&Number(match[1])<24&&Number(match[2])<60?`${match[1]}:${match[2]}`:null;
}
const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
export function weatherDaylight(at,sunrise,sunset){
 const {hour,minute}=weatherClock(at),time=hour*60+minute;
 return time>=(sunrise?minutes(sunrise):360)&&time<(sunset?minutes(sunset):1080);
}
/** Wake at the next turn, midnight or solar change even inside the 30-minute TTL. */
export function weatherRefreshDelay(at=Date.now(),forecasts=[]){
 const {date,hour,minute,second}=weatherClock(at),elapsed=(hour*3600+minute*60+second)*1000+at%1000;
 const boundaries=[6,12,18,24].map(hour=>hour*3600000);
 for(const row of forecasts){if(row.date!==date)continue;for(const value of [row.sunrise,row.sunset]){const valid=weatherSolarTime(value);if(valid)boundaries.push(minutes(valid)*60000);}}
 return Math.min(1800000,...boundaries.filter(value=>value>elapsed).map(value=>value-elapsed+50));
}
