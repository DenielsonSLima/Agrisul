import test from 'node:test';
import assert from 'node:assert/strict';
import {NEWS_SOURCES,createNewsFeed,parseNewsRss,safeNewsUrl,classifyNewsTopic,curateNews,parseNewsPageImage} from './providers.mjs';
import {newsForScope,newsTopicLabel} from './presentation.ts';
const at=Date.parse('2026-10-29T15:00:00Z'),source=NEWS_SOURCES[0];
function rss(provider,index=0,extra='<enclosure url="https://cdn.example.com/article.jpg" type="image/jpeg"/>'){
 return `<rss><channel><item><title><![CDATA[Cana &amp; etanol ${index}]]></title><link>https://${provider.domain}/noticia-${index}?utm_source=rss</link><pubDate>${new Date(at-index*60000).toUTCString()}</pubDate><description><![CDATA[<p>Resumo da notícia do setor sucroenergético para conferência.</p><p>O post apareceu primeiro no jornal.</p>]]></description>${extra}</item></channel></rss>`;
}
test('RSS extracts plain headlines, attribution, exact publication dates and optional publisher images',()=>{
 const [item]=parseNewsRss(rss(source,0,'<media:content url="https://uploads.jornalcana.com.br/cana.jpg" medium="image"/>'),source,at);
 assert.equal(item.title,'Cana & etanol 0');assert.equal(item.url,'https://jornalcana.com.br/noticia-0');assert.equal(item.publishedAt,new Date(at).toISOString());assert.equal(item.sourceName,'JornalCana');assert.equal(item.topic,'cane');assert.equal(item.imageUrl,'https://uploads.jornalcana.com.br/cana.jpg');assert.equal(item.description.includes('O post'),false);
 const [video]=parseNewsRss(rss(source,1,'<media:content url="https://www.youtube.com/embed/abc"/>'),source,at);assert.equal(video.imageUrl,null);
 const [image]=parseNewsRss(rss(source,2,'<content:encoded><![CDATA[<img src="https://uploads.jornalcana.com.br/foto.png"/>]]></content:encoded>'),source,at);assert.equal(image.imageUrl,'https://uploads.jornalcana.com.br/foto.png');
});
test('feed normalization rejects entity declarations, foreign destinations, local URLs, invalid and future dates',()=>{
 for(const url of ['javascript:alert(1)','http://example.com/a','https://127.0.0.1/image.jpg','https://0.0.0.0/a','https://user:pass@example.com/a','https://internal.local/image'])assert.equal(safeNewsUrl(url),null);
 assert.equal(safeNewsUrl('https://foreign.example/noticia',source.domain),null);
 assert.deepEqual(parseNewsRss('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+rss(source),source,at),[]);
 assert.deepEqual(parseNewsRss(rss(source).replace(new Date(at).toUTCString(),'invalid'),source,at),[]);
 assert.deepEqual(parseNewsRss(rss(source).replace(new Date(at).toUTCString(),new Date(at+3600000).toUTCString()),source,at),[]);
 assert.deepEqual(parseNewsRss('<html>unavailable</html>',source,at),[]);
});
test('concurrent and warm requests share one fetch per source and refresh after five minutes',async()=>{
 let now=at,calls=0;
 const feed=createNewsFeed({now:()=>now,fetchImpl:async url=>{calls++;const provider=NEWS_SOURCES.find(source=>source.url===url);await Promise.resolve();return new Response(rss(provider));}});
 const [first,second]=await Promise.all([feed(),feed()]);assert.equal(calls,NEWS_SOURCES.length);assert.deepEqual(first,second);assert.equal(first.sources.every(source=>source.status==='current'),true);
 await feed();assert.equal(calls,NEWS_SOURCES.length);now+=301000;await feed();assert.equal(calls,NEWS_SOURCES.length*2);
});
test('outages preserve original publication and last success timestamps, then expire stale fallback',async()=>{
 let now=at,failed=false;
 const feed=createNewsFeed({now:()=>now,fetchImpl:async url=>{if(failed)throw Error('offline');return new Response(rss(NEWS_SOURCES.find(source=>source.url===url)));}});
 const first=await feed();failed=true;now+=301000;const stale=await feed();
 assert.equal(stale.sources.every(source=>source.status==='cached'),true);assert.equal(stale.articles[0].publishedAt,first.articles[0].publishedAt);assert.equal(stale.sources[0].updatedAt,first.sources[0].updatedAt);
 now=at+25*3600000;const expired=await feed();assert.equal(expired.articles.length,0);assert.equal(expired.sources.every(source=>source.status==='unavailable'),true);
});
test('partial source failure does not discard other publishers or retain full article bodies',async()=>{
 const feed=createNewsFeed({now:()=>at,fetchImpl:async url=>{if(url===NEWS_SOURCES[1].url)throw Error('offline');const provider=NEWS_SOURCES.find(source=>source.url===url);return new Response(rss(provider));}});
 const result=await feed();assert.ok(result.articles.length);assert.equal(result.sources[1].status,'unavailable');assert.equal(result.sources[0].status,'current');assert.equal('content' in result.articles[0],false);
});

test('a source ignoring cancellation cannot block the shared feed or its next attempt',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let stalled=true,bodyStalled=false;
 const signals=[];
 const feed=createNewsFeed({now:()=>at,fetchImpl:async(url,options)=>{
  const provider=NEWS_SOURCES.find(source=>source.url===url);
  if(provider.id===source.id){
   signals.push(options.signal);
   if(stalled)return new Promise(()=>{});
   if(bodyStalled)return new Response(new ReadableStream({start(){}}));
  }
  return new Response(rss(provider));
 }});
 try{
  const first=feed();await new Promise(setImmediate);t.mock.timers.tick(6000);
  const partial=await first;
  assert.equal(partial.sources[0].status,'unavailable');assert.ok(partial.articles.length);
  assert.equal(signals[0].aborted,true);
  stalled=false;bodyStalled=true;
  const second=feed();await new Promise(setImmediate);t.mock.timers.tick(6000);
  assert.equal((await second).sources[0].status,'unavailable');
  bodyStalled=false;
  const recovered=await feed();assert.equal(recovered.sources[0].status,'current');
  assert.ok(recovered.articles.some(article=>article.sourceId===source.id));
 }finally{t.mock.timers.reset();}
});
test('specialist headlines remain available when general feeds publish more recent stories',async()=>{
 const feed=createNewsFeed({now:()=>at,fetchImpl:async url=>{const provider=NEWS_SOURCES.find(source=>source.url===url),cane=provider.id==='jornalcana';const items=Array.from({length:cane?10:40},(_,index)=>`<item><title>${cane?'Cana especializada':'Soja '+provider.id} ${index}</title><link>https://${provider.domain}/${index}</link><pubDate>${new Date(at-(cane?3600000:0)-index*1000).toUTCString()}</pubDate></item>`).join('');return new Response('<rss><channel>'+items+'</channel></rss>');}});
 const result=await feed();assert.equal(result.articles.length,30);assert.equal(result.articles.filter(article=>article.sourceId==='jornalcana').length,10);assert.equal(new Set(result.articles.map(article=>article.id)).size,30);
});

test('classification uses the subject, all categories and corn ethanol context, never the publisher',()=>{
 for(const title of ['Volare Fly 10 GV integra frota da Sertran e impulsiona a descarbonização do fretamento','Cargill abre inscrições para o Programa de Trainee 2027','Usina de energia solar amplia capacidade','Bioenergia avança no Brasil'])assert.equal(classifyNewsTopic(title),'agro',title);
 for(const title of ['Açúcar cai em Nova York','Moagem da cana cresce','Setor sucroenergético divulga balanço','Etanol sobe nas usinas'])assert.equal(classifyNewsTopic(title),'cane',title);
 for(const title of ['Etanol de milho avança','Soja sobe em Chicago','Colheita de milho ganha ritmo'])assert.equal(classifyNewsTopic(title),'grains',title);
 assert.equal(classifyNewsTopic('Etanol de milho avança',['Sucroenergético']),'grains');
 assert.equal(classifyNewsTopic('Resultado da safra',['Mercado','Sucroenergético']),'cane');
 const xml=rss(source).replace('Cana &amp; etanol 0','Cargill abre inscrições para trainee').replace('Resumo da notícia do setor sucroenergético para conferência.','Inscrições abertas para jovens profissionais.');
 assert.equal(parseNewsRss(xml,source,at)[0].topic,'agro');
 assert.equal(parseNewsRss(xml.replace('</item>','<category>Geral</category><category>Sucroenergético</category></item>'),source,at)[0].topic,'cane');
});

function candidates(count=40){
 return ['cane','grains','agro'].flatMap((topic,group)=>Array.from({length:count},(_,index)=>({id:`${topic}-${index}`,url:`https://example.com/${topic}-${index}`,title:`${topic} ${index}`,topic,category:topic,publishedAt:new Date(at-group*3600000-index*1000).toISOString(),imageUrl:null})));
}
test('editorial selection is exactly 15 cane, 6 grains and 9 general, interleaved without depending on photos',()=>{
 const input=candidates(),original=[...input],selected=curateNews(input,30,at);
 assert.equal(selected.length,30);assert.deepEqual(input,original);
 const counts=rows=>rows.reduce((counts,row)=>({...counts,[row.topic]:(counts[row.topic]??0)+1}),{});
 assert.deepEqual(counts(selected),{cane:15,agro:9,grains:6});
 assert.deepEqual(counts(selected.slice(0,6)),{cane:3,agro:2,grains:1});
 assert.equal(selected[0].topic,'cane');assert.equal(selected.every(row=>row.imageUrl===null),true);
 for(const topic of ['cane','grains','agro']){const times=selected.filter(row=>row.topic===topic).map(row=>row.publishedAt);assert.deepEqual(times,[...times].sort().reverse());}
 assert.deepEqual(newsForScope(selected,'all'),selected);
 assert.equal(newsForScope(selected,'cane').length,15);assert.equal(newsForScope(selected,'cane').every(row=>row.topic==='cane'),true);
 assert.deepEqual(newsForScope(selected.filter(row=>row.topic!=='cane'),'cane'),[],'A cane-only filter must not silently show general articles');
 assert.equal(newsTopicLabel(selected.find(row=>row.topic==='grains')),'Soja e milho');
});

test('shortages redistribute only real unique recent articles and never change their topics',()=>{
 const input=candidates(10).filter(row=>row.topic!=='cane'),duplicate={...input[0],id:'duplicate',url:'https://another.example/same'},old={...candidates(1)[0],id:'old',title:'Old cane',publishedAt:new Date(at-8*86400000).toISOString()};
 const selected=curateNews([...input,duplicate,old,input[1]],30,at);
 assert.equal(selected.length,20);assert.equal(new Set(selected.map(row=>row.url)).size,20);assert.equal(selected.some(row=>row.topic==='cane'),false);
 assert.deepEqual(curateNews([],30,at),[]);
});

const htmlResponse=html=>new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
test('article image metadata accepts attribute order, escaped and relative URLs and Twitter fallback',()=>{
 const page='https://www.noticiasagricolas.com.br/noticias/cana.html';
 assert.equal(parseNewsPageImage('<meta content="/images/cana.jpg?a=1&amp;b=2" property="og:image">',page),'https://www.noticiasagricolas.com.br/images/cana.jpg?a=1&b=2');
 assert.equal(parseNewsPageImage("<meta name='twitter:image' content='https://cdn.example.com/cana.jpg'>",page),'https://cdn.example.com/cana.jpg');
 for(const bad of ['javascript:alert(1)','https://127.0.0.1/foto.jpg','https://www.youtube.com/embed/video','https://cdn.example.com/logo.jpg']){
  assert.equal(parseNewsPageImage(`<meta property="og:image" content="${bad}">`,page),null);
 }
 assert.equal(parseNewsPageImage('<meta property="og:image" content="https://cdn.example.com/logo.jpg"><meta name="twitter:image" content="https://cdn.example.com/article.jpg">',page),'https://cdn.example.com/article.jpg');
 assert.equal(parseNewsPageImage('<html>No article photo</html>',page),null);
});

test('missing RSS images are enriched once across concurrent feeds and cached beyond RSS refresh without changing source articles',async()=>{
 let now=at,imageCalls=0,feedCalls=0;
 const feed=createNewsFeed({now:()=>now,fetchImpl:async(url,options)=>{
  const provider=NEWS_SOURCES.find(source=>source.url===url);
  if(provider){feedCalls++;return new Response(rss(provider,0,provider.id===source.id?'':undefined));}
  imageCalls++;assert.equal(options.redirect,'manual');assert.equal(options.headers['User-Agent'],'AgrisulDashboard/1.0 RSS reader');
  return htmlResponse('<meta property="og:image" content="https://cdn.example.com/from-page.jpg">');
 }});
 const [first,second]=await Promise.all([feed(),feed()]);assert.deepEqual(first,second);assert.equal(imageCalls,1);
 const article=first.articles.find(article=>article.sourceId===source.id);assert.equal(article.imageUrl,'https://cdn.example.com/from-page.jpg');
 assert.equal(article.title,'Cana & etanol 0');assert.equal(article.topic,'cane');assert.equal(article.publishedAt,new Date(at).toISOString());
 await feed();assert.equal(imageCalls,1);assert.equal(feedCalls,NEWS_SOURCES.length);
 now+=301000;await feed();assert.equal(imageCalls,1);assert.equal(feedCalls,NEWS_SOURCES.length*2);
 now+=24*3600000;await feed();assert.equal(imageCalls,2);
});

test('absent metadata is cached briefly and failures never remove a valid RSS article',async()=>{
 let now=at,imageCalls=0;
 const feed=createNewsFeed({now:()=>now,fetchImpl:async url=>{
  const provider=NEWS_SOURCES.find(source=>source.url===url);
  if(provider)return new Response(rss(provider,0,provider.id===source.id?'':undefined));
  imageCalls++;return htmlResponse('<html>No photo</html>');
 }});
 const first=await feed();assert.ok(first.articles.some(article=>article.sourceId===source.id&&article.imageUrl===null));
 await feed();assert.equal(imageCalls,1);now+=301000;await feed();assert.equal(imageCalls,2);
});

test('article lookups follow only publisher redirects, reject oversized pages and retain headlines',async()=>{
 for(const kind of ['external','local','oversized','blocked','redirect']){
  const pageCalls=[];
  const feed=createNewsFeed({now:()=>at,fetchImpl:async url=>{
   const provider=NEWS_SOURCES.find(source=>source.url===url);
   if(provider)return new Response(rss(provider,0,provider.id===source.id?'':undefined));
   pageCalls.push(url);
   if(kind==='blocked')return new Response('Denied',{status:403});
   if(kind==='oversized')return htmlResponse('x'.repeat(300_001));
   if(pageCalls.length===1)return new Response(null,{status:302,headers:{Location:kind==='external'?'https://foreign.example/news':kind==='local'?'https://127.0.0.1/news':'/canonical'}});
   return htmlResponse('<meta property="og:image" content="https://cdn.example.com/redirect.jpg">');
  }});
  const result=await feed(),article=result.articles.find(article=>article.sourceId===source.id);
  assert.equal(article.imageUrl,kind==='redirect'?'https://cdn.example.com/redirect.jpg':null);
  assert.equal(pageCalls.length,kind==='redirect'?2:1);assert.equal(result.sources[0].status,'current');
 }
});

test('photo lookup concurrency and total deadline are bounded even when a publisher ignores abort, then recover',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let stalled=true,active=0,peak=0;
 const signals=[];
 const feed=createNewsFeed({now:()=>at,fetchImpl:async(url,options)=>{
  const provider=NEWS_SOURCES.find(source=>source.url===url);
  if(provider){
   if(provider.id!==source.id)return new Response('offline',{status:503});
   return new Response('<rss><channel>'+Array.from({length:30},(_,index)=>rss(provider,index,'').match(/<item>[\s\S]*<\/item>/)[0]).join('')+'</channel></rss>');
  }
  if(stalled){
   signals.push(options.signal);active++;peak=Math.max(peak,active);
   options.signal.addEventListener('abort',()=>active--,{once:true});
   return new Promise(()=>{});
  }
  return htmlResponse('<meta property="og:image" content="https://cdn.example.com/recovered.jpg">');
 }});
 try{
  const request=feed();await new Promise(setImmediate);assert.equal(peak,6);
  t.mock.timers.tick(1500);await new Promise(setImmediate);
  t.mock.timers.tick(2500);const result=await request;
  assert.equal(result.articles.length,30);assert.equal(result.sources[0].status,'current');assert.equal(peak,6);assert.equal(active,0);
  assert.ok(signals.every(signal=>signal.aborted));
  stalled=false;const recovered=await feed();assert.equal(recovered.articles.every(article=>article.imageUrl==='https://cdn.example.com/recovered.jpg'),true);
 }finally{t.mock.timers.reset();}
});
