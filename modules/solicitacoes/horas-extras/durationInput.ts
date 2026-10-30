export type DurationEdit={digits:string;hourWidth:number};

export function durationDisplay({digits,hourWidth}:DurationEdit){
 if(!digits)return '';
 const hours=digits.slice(0,hourWidth).padStart(hourWidth,'0');
 return hours+':'+digits.slice(hourWidth,hourWidth+2).padEnd(2,'0')+':'+digits.slice(hourWidth+2,hourWidth+4).padEnd(2,'0');
}

export function durationFromText(value:string):DurationEdit|null{
 const text=value.trim();
 if(!text)return {digits:'',hourWidth:2};
 if(/^\d{1,6}:\d{1,2}(?::\d{1,2})?$/.test(text)){
  const [hours,minutes='',seconds='']=text.split(':'),hourWidth=Math.max(2,hours.length);
  return {hourWidth,digits:hours.padStart(hourWidth,'0')+minutes.padStart(2,'0')+seconds.padStart(2,'0')};
 }
 if(/^\d{1,6}$/.test(text))return {digits:text,hourWidth:2};
 return null;
}

export function durationRawPosition(edit:DurationEdit,displayPosition:number){
 const padding=Math.max(0,edit.hourWidth-edit.digits.length);
 const digits=durationDisplay(edit).slice(0,displayPosition).replace(/\D/g,'').length;
 return Math.max(0,Math.min(edit.digits.length,digits-padding));
}

export function durationCursor(edit:DurationEdit,rawPosition:number){
 const padding=Math.max(0,edit.hourWidth-edit.digits.length);
 if(rawPosition<edit.hourWidth)return rawPosition+padding;
 if(rawPosition<edit.hourWidth+2)return rawPosition+1;
 return rawPosition+2;
}

export function editDuration(edit:DurationEdit,start:number,end:number,inserted:string){
 const from=Math.max(0,Math.min(start,edit.digits.length)),to=Math.max(from,Math.min(end,edit.digits.length));
 const digits=edit.digits.slice(0,from)+inserted+edit.digits.slice(to);
 if(!/^\d*$/.test(digits)||digits.length>edit.hourWidth+4)return null;
 return {edit:{...edit,digits},cursor:from+inserted.length};
}

// Completion only controls keyboard focus. The RPC remains responsible for validation.
export function durationCompletionDelay(edit:DurationEdit){
 const {digits,hourWidth}=edit;
 const minutes=digits.slice(hourWidth,hourWidth+2),seconds=digits.slice(hourWidth+2);
 if(Number(minutes)>59||Number(seconds)>59)return null;
 if(digits.length===hourWidth+4)return 0;
 if(digits.length===hourWidth+2)return 650;
 return null;
}
