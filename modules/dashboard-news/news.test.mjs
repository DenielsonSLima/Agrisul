import test from 'node:test';
import assert from 'node:assert/strict';
import {NEWS_SOURCES,createNewsFeed,parseNewsRss,safeNewsUrl} from './providers.mjs';
const at=Date.parse('2026-10-29T15:00:00Z'),source=NEWS_SOURCES[0];
function rss(provider,index=0,extra=''){
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
 const [first,second]=await Promise.all([feed(),feed()]);assert.equal(calls,3);assert.deepEqual(first,second);assert.equal(first.sources.every(source=>source.status==='current'),true);
 await feed();assert.equal(calls,3);now+=301000;await feed();assert.equal(calls,6);
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
test('specialist headlines remain available when general feeds publish more recent stories',async()=>{
 const feed=createNewsFeed({now:()=>at,fetchImpl:async url=>{const provider=NEWS_SOURCES.find(source=>source.url===url),cane=provider.cane;const items=Array.from({length:cane?10:40},(_,index)=>`<item><title>${cane?'Cana especializada':'Soja '+provider.id} ${index}</title><link>https://${provider.domain}/${index}</link><pubDate>${new Date(at-(cane?3600000:0)-index*1000).toUTCString()}</pubDate></item>`).join('');return new Response('<rss><channel>'+items+'</channel></rss>');}});
 const result=await feed();assert.equal(result.articles.length,24);assert.equal(result.articles.filter(article=>article.sourceId==='jornalcana').length,10);assert.equal(new Set(result.articles.map(article=>article.id)).size,24);
});
