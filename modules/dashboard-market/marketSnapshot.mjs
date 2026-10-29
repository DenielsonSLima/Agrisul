// Public reference prices only. A snapshot preserves source publication times;
// loading it never turns a previous publication into a newly observed price.
export const marketFeedGroups={
  currency:{ids:['usd','eur'],refreshSeconds:60},
  agriculture:{ids:['soy','corn','cattle','wheat','rice','beans','pork','chicken'],refreshSeconds:600},
  cane:{ids:['cane'],refreshSeconds:600},
};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const decimal=(value,positive=false)=>typeof value==='string'&&value.length<=80&&
  (positive?/^\d+(?:\.\d+)?$/:/^-?\d+(?:\.\d+)?$/).test(value)&&Number.isFinite(Number(value))&&(!positive||Number(value)>0);
function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function validTimestamp(value){
  if(typeof value!=='string')return false;
  const match=value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/);
  return !!match&&validDate(match[1])&&Number(match[2])<24&&Number(match[3])<60&&Number(match[4])<60&&
    (!match[5]||Number(match[6])<24&&Number(match[7])<60)&&Number.isFinite(Date.parse(value));
}
function publicSource(value){
  if(typeof value!=='string'||value.length>2048)return false;
  try{const url=new URL(value);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password;}catch{return false;}
}
export function parseMarketFeed(value,group){
  const config=Object.hasOwn(marketFeedGroups,group)?marketFeedGroups[group]:undefined;
  if(!config||!record(value)||!Array.isArray(value.quotes)||!value.quotes.length||value.quotes.length>config.ids.length||
    !validTimestamp(value.checkedAt)||!Number.isInteger(value.refreshSeconds)||value.refreshSeconds<1||value.refreshSeconds>86400)return null;
  const seen=new Set(),quotes=[];
  for(const quote of value.quotes){
    if(!record(quote)||!config.ids.includes(quote.id)||seen.has(quote.id)||
      !['available','stale','unavailable'].includes(quote.status)||
      typeof quote.source!=='string'||!quote.source.trim()||quote.source.length>200||
      !publicSource(quote.sourceUrl)||typeof quote.note!=='string'||quote.note.length>2000||
      (quote.observedAt!==undefined&&!validTimestamp(quote.observedAt))||
      (quote.changePercent!==undefined&&!decimal(quote.changePercent))||
      (quote.status==='unavailable'?(quote.value!==null||quote.date!==null):(!decimal(quote.value,true)||!validDate(quote.date))))return null;
    seen.add(quote.id);
    quotes.push({id:quote.id,value:quote.value,date:quote.date,status:quote.status,source:quote.source,sourceUrl:quote.sourceUrl,note:quote.note,
      ...(quote.observedAt===undefined?{}:{observedAt:quote.observedAt}),...(quote.changePercent===undefined?{}:{changePercent:quote.changePercent})});
  }
  return {quotes,checkedAt:value.checkedAt,refreshSeconds:config.refreshSeconds};
}
const usable=quote=>quote&&quote.status!=='unavailable'&&quote.value!==null;
function regressed(previous,next){
  if(next.date!==previous.date)return next.date<previous.date;
  if(previous.observedAt&&!next.observedAt)return true;
  return previous.observedAt&&next.observedAt?Date.parse(next.observedAt)<Date.parse(previous.observedAt):false;
}
export function staleMarketFeed(feed){
  return {...feed,quotes:feed.quotes.map(quote=>usable(quote)?{...quote,status:'stale'}:{...quote})};
}
export function mergeMarketFeed(previous,next,group){
  const current=parseMarketFeed(next,group);
  if(!current)return null;
  const cached=parseMarketFeed(previous,group);
  if(!cached)return current;
  const quotes=marketFeedGroups[group].ids.flatMap(id=>{
    const old=cached.quotes.find(quote=>quote.id===id),fresh=current.quotes.find(quote=>quote.id===id);
    if(usable(fresh)&&(!usable(old)||!regressed(old,fresh)))return [fresh];
    if(usable(old))return [{...old,status:'stale'}];
    return fresh?[fresh]:[];
  });
  return {...current,quotes};
}
export function marketSnapshotKey(userId,group){
  return typeof userId==='string'&&userId&&Object.hasOwn(marketFeedGroups,group)?`billing:dashboard-market:feed:v1:${encodeURIComponent(userId)}:${group}`:null;
}
export function readMarketSnapshot(storage,userId,group){
  try{
    const key=marketSnapshotKey(userId,group);if(!key||!storage)return undefined;
    const raw=storage.getItem(key);if(!raw||raw.length>50000)return undefined;
    const value=JSON.parse(raw);
    if(!record(value)||value.version!==1||value.userId!==userId||value.group!==group)return undefined;
    const feed=parseMarketFeed(value.feed,group);
    return feed&&feed.quotes.some(usable)?staleMarketFeed(feed):undefined;
  }catch{return undefined;}
}
export function saveMarketSnapshot(storage,userId,group,value){
  try{
    const key=marketSnapshotKey(userId,group);if(!key||!storage)return;
    const feed=mergeMarketFeed(readMarketSnapshot(storage,userId,group),value,group);
    if(!feed||!feed.quotes.some(usable))return;
    storage.setItem(key,JSON.stringify({version:1,userId,group,feed}));
  }catch{/* Storage is optional; TanStack Query remains the remote state. */}
}
