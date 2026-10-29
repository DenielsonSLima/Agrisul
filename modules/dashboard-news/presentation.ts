export function headlineIntervalMs(slideDurationMs:number,count:number){
 return Number.isFinite(slideDurationMs)&&slideDurationMs>0&&Number.isInteger(count)&&count>0?slideDurationMs/count:null;
}
export function usableNewsImage(value:string|null){
 if(!value)return false;
 try{const url=new URL(value);return url.protocol==='https:'&&!/(?:^|\.)(?:youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com)$/.test(url.hostname);}catch{return false;}
}
