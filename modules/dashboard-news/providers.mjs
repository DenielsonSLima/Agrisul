export const NEWS_REFRESH_SECONDS=300;
export const NEWS_SOURCES=[
 {id:'jornalcana',name:'JornalCana',url:'https://jornalcana.com.br/feed/',domain:'jornalcana.com.br'},
 {id:'canal-rural',name:'Canal Rural',url:'https://www.canalrural.com.br/feed/',domain:'canalrural.com.br'},
 {id:'noticias-agricolas',name:'Notícias Agrícolas',url:'https://www.noticiasagricolas.com.br/noticias.rss',domain:'noticiasagricolas.com.br'},
 {id:'na-cana',name:'Notícias Agrícolas · Sucroenergético',url:'https://www.noticiasagricolas.com.br/noticias/sucroenergetico.rss',domain:'noticiasagricolas.com.br'},
 {id:'na-soja',name:'Notícias Agrícolas · Soja',url:'https://www.noticiasagricolas.com.br/noticias/soja.rss',domain:'noticiasagricolas.com.br'},
 {id:'na-milho',name:'Notícias Agrícolas · Milho',url:'https://www.noticiasagricolas.com.br/noticias/milho.rss',domain:'noticiasagricolas.com.br'},
];
const MAX_BYTES=1_500_000,MAX_CACHE_AGE=24*60*60*1000;
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”',aacute:'á',Aacute:'Á',atilde:'ã',Atilde:'Ã',acirc:'â',eacute:'é',ecirc:'ê',iacute:'í',oacute:'ó',otilde:'õ',ocirc:'ô',uacute:'ú',ccedil:'ç',Ccedil:'Ç'};
const unwrap=value=>String(value??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1');
function decode(value){return unwrap(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/gi,(whole,key)=>{
 if(key[0]!=='#')return entities[key]??whole;
 const point=key[1]?.toLowerCase()==='x'?Number.parseInt(key.slice(2),16):Number.parseInt(key.slice(1),10);
 return point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):'';
});}
function plain(value,max=240){return decode(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
const field=(xml,name)=>new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i').exec(xml)?.[1]??'';
const attribute=(tag,name)=>new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`,'i').exec(tag)?.[1]??'';
const normalized=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

// The publisher is attribution, never evidence of an article's subject.
export function classifyNewsTopic(title,categories=[],description=''){
 const cane=/\b(?:cana|acucar|acucareir\w*|sucro\w*|consecana|canav\w*|mastercana)\b/;
 const grains=/\b(?:soja|milho)\b/;
 const headline=normalized(title),context=normalized(categories.join(' ')+' '+description);
 if(cane.test(headline))return 'cane';
 if(grains.test(headline))return 'grains';
 if(cane.test(context))return 'cane';
 if(grains.test(context))return 'grains';
 // Ethanol without a corn reference belongs to the sugar/ethanol market.
 return /\b(?:etanol|renovabio)\b/.test(headline+' '+context)?'cane':'agro';
}

// Each complete cycle reserves 50% cane, 20% grains and 30% general news.
// Missing topics borrow the newest available story, without changing its label.
export function curateNews(articles,limit=30,now=Date.now()){
 const recent=articles.filter(article=>now-Date.parse(article.publishedAt)<=7*24*60*60*1000)
  .sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
 const urls=new Set(),titles=new Set(),queues={cane:[],grains:[],agro:[]};
 for(const article of recent){
  const title=normalized(article.title).replace(/[^a-z0-9]/g,'');
  if(urls.has(article.url)||titles.has(title))continue;
  urls.add(article.url);titles.add(title);queues[article.topic].push(article);
 }
 const cycle=['cane','agro','cane','grains','cane','agro','cane','grains','cane','agro'],chosen=[];
 while(chosen.length<limit){
  const preferred=cycle[chosen.length%cycle.length];
  const queue=queues[preferred].length?queues[preferred]:Object.values(queues).filter(queue=>queue.length)
   .sort((a,b)=>Date.parse(b[0].publishedAt)-Date.parse(a[0].publishedAt))[0];
  if(!queue)break;
  chosen.push(queue.shift());
 }
 return chosen;
}

export function safeNewsUrl(value,domain){
 try{
  const url=new URL(decode(value).trim());
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')
   ||/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname)
   ||/^\d+(?:\.\d+){3}$/.test(url.hostname)||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal'))return null;
  if(domain&&url.hostname!==domain&&!url.hostname.endsWith('.'+domain))return null;
  url.hash='';
  for(const key of [...url.searchParams.keys()])if(key.startsWith('utm_')||['fbclid','gclid'].includes(key))url.searchParams.delete(key);
  return url.toString();
 }catch{return null;}
}
function articleImage(item){
 const imageUrl=value=>{const url=safeNewsUrl(value);if(!url)return null;return /(?:^|\.)(?:youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com)$/.test(new URL(url).hostname)?null:url;};
 for(const match of item.matchAll(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/gi)){
  const type=attribute(match[0],'type'),medium=attribute(match[0],'medium');if(type&&!type.startsWith('image/')||medium&&medium!=='image')continue;
  const url=imageUrl(attribute(match[0],'url'));if(url)return url;
 }
 const html=decode(field(item,'description')+' '+field(item,'content:encoded'));
 for(const match of html.matchAll(/<img\b[^>]*>/gi)){
  const tag=match[0];if(attribute(tag,'width')==='1'||attribute(tag,'height')==='1')continue;
  const url=imageUrl(attribute(tag,'src'));if(url&&!/gravatar|tracking|spacer/i.test(url))return url;
 }
 return null;
}

export function parseNewsRss(xml,source,now=Date.now()){
 if(typeof xml!=='string'||xml.length>MAX_BYTES||!/<rss\b/i.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))return [];
 const articles=[];
 for(const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)){
  const item=match[1],title=plain(field(item,'title'),240),url=safeNewsUrl(unwrap(field(item,'link')),source.domain),published=Date.parse(plain(field(item,'pubDate'),100));
  if(!title||!url||!Number.isFinite(published)||published>now+10*60*1000)continue;
  const categories=[...item.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map(match=>plain(match[1],60));
  const description=plain(field(item,'description'),700).replace(/\s*O post\s[\s\S]*$/i,'').trim();
  const topic=classifyNewsTopic(title,categories,description),category=topic==='cane'?'Cana, açúcar e etanol':topic==='grains'?'Soja e milho':categories.find(value=>! /^(?:geral|noticias|sem categoria)$/i.test(normalized(value)))||'Agronegócio';
  articles.push({id:url,title,description:description.length>=35?description.slice(0,190):'',url,imageUrl:articleImage(item),
   publishedAt:new Date(published).toISOString(),sourceId:source.id,sourceName:source.name,topic,category});
  if(articles.length===60)break;
 }
 return articles;
}
async function limitedText(response){
 if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('Feed muito grande.');
 if(!response.body)return '';
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES)throw Error('Feed muito grande.');chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return new TextDecoder().decode(bytes);
}

export function createNewsFeed({fetchImpl=(...args)=>globalThis.fetch(...args),now=Date.now}={}){
 const cache=new Map(),pending=new Map();
 function sourceFeed(source){
  const saved=cache.get(source.id);
  const result=(articles,status,at)=>({articles,source:{id:source.id,name:source.name,url:source.url,status,updatedAt:at===null?null:new Date(at).toISOString()}});
  if(saved&&now()-saved.at<NEWS_REFRESH_SECONDS*1000)return Promise.resolve(result(saved.articles,'current',saved.at));
  if(pending.has(source.id))return pending.get(source.id);
  const task=Promise.resolve().then(async()=>{
   const controller=new AbortController();let timer;
   try{
    // Some development fetch wrappers do not settle when their signal aborts.
    // Release the shared pending entry even if transport or body reading stalls.
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
     const error=new Error('Tempo de consulta da fonte esgotado.');controller.abort(error);reject(error);
    },6000);});
    const articles=await Promise.race([deadline,(async()=>{
     const response=await fetchImpl(source.url,{cache:'no-store',headers:{Accept:'application/rss+xml, application/xml, text/xml','User-Agent':'AgrisulDashboard/1.0 RSS reader'},signal:controller.signal});
     controller.signal.throwIfAborted();
     if(!response.ok||response.url&&!safeNewsUrl(response.url,source.domain))throw Error('Feed indisponível.');
     const articles=parseNewsRss(await limitedText(response),source,now());if(!articles.length)throw Error('Feed sem notícias válidas.');
     return articles;
    })()]);
    const at=now();cache.set(source.id,{articles,at});return result(articles,'current',at);
   }catch{return saved&&now()-saved.at<=MAX_CACHE_AGE?result(saved.articles,'cached',saved.at):result([],'unavailable',null);}
   finally{clearTimeout(timer);pending.delete(source.id);}
  });
  pending.set(source.id,task);return task;
 }
 return async()=>{
  const responses=await Promise.all(NEWS_SOURCES.map(sourceFeed));
  const chosen=curateNews(responses.flatMap(response=>response.articles),30,now());
  return {articles:chosen,sources:responses.map(response=>response.source),checkedAt:new Date(now()).toISOString(),refreshSeconds:NEWS_REFRESH_SECONDS};
 };
}
const loadFeed=createNewsFeed();
export const getNewsFeed=()=>loadFeed();
