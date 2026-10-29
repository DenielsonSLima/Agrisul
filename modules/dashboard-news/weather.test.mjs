import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeatherProvider,normalizeInmetForecast} from './weatherProviders.mjs';
import {readWeatherCities,weatherPreferencesKey} from './weatherCatalog.ts';
import {headlineIntervalMs,usableNewsImage} from './presentation.ts';
const at=Date.parse('2026-10-29T13:00:00Z'),defaults=readWeatherCities('');
const forecast=(id,day='29/10/2026')=>({[id]:{[day]:{manha:{resumo:'Muitas nuvens',temp_min:22,temp_max:32,umidade_min:50,umidade_max:95},tarde:{resumo:'Chuva à tarde',temp_min:23,temp_max:33},noite:{resumo:'Nublado à noite',temp_min:20,temp_max:28}}}});
test('requested cities have distinct official IBGE identities and valid account-scoped preferences',()=>{
 assert.deepEqual(defaults.map(city=>city.name),['Japaratuba','Japoatã','Maceió','Pacatuba','Salvador']);assert.equal(defaults[3].id,'2804904');assert.equal(defaults[3].state,'SE');
 assert.notEqual(weatherPreferencesKey('a'),weatherPreferencesKey('b'));assert.equal(weatherPreferencesKey(null),null);
 assert.deepEqual(readWeatherCities('{'),defaults);assert.deepEqual(readWeatherCities(JSON.stringify({version:1,cities:[defaults[0],defaults[0]]})),defaults);
 assert.deepEqual(readWeatherCities(JSON.stringify({version:1,cities:[]})),[]);
 assert.deepEqual(readWeatherCities(JSON.stringify({version:1,cities:[defaults[4]]})),[defaults[4]]);
});
test('today and time of day use Brasilia; missing values are not fabricated as zero',()=>{
 const row=normalizeInmetForecast(forecast(defaults[0].id),defaults[0],at);assert.equal(row.minimum,22);assert.equal(row.maximum,32);assert.equal(row.condition,'Muitas nuvens');assert.equal(row.date,'2026-10-29');
 const evening=normalizeInmetForecast(forecast(defaults[0].id),defaults[0],Date.parse('2026-10-30T01:00:00Z'));assert.equal(evening.date,'2026-10-29');assert.equal(evening.condition,'Nublado à noite');
 const missing=forecast(defaults[0].id);missing[defaults[0].id]['29/10/2026'].manha.temp_min=null;assert.equal(normalizeInmetForecast(missing,defaults[0],at).minimum,null);
 assert.equal(normalizeInmetForecast(forecast(defaults[0].id,'28/10/2026'),defaults[0],at),null);
 const inverted=forecast(defaults[0].id);inverted[defaults[0].id]['29/10/2026'].manha.temp_min=40;assert.equal(normalizeInmetForecast(inverted,defaults[0],at),null);
});
test('weather requests deduplicate by municipality, preserve input order and retain dated stale fallback',async()=>{
 let now=at,calls=0,failed=false;const provider=createWeatherProvider({now:()=>now,fetchImpl:async url=>{calls++;if(failed)throw Error('offline');const id=url.split('/').at(-1);return Response.json(forecast(id));}});
 const ids=defaults.map(city=>city.id);const [a,b]=await Promise.all([provider.feed(ids),provider.feed(ids)]);assert.equal(calls,5);assert.deepEqual(a,b);assert.deepEqual(a.cities.map(row=>row.city.id),ids);assert.equal(a.cities.every(row=>row.status==='current'),true);
 await provider.feed(ids.slice(0,2));assert.equal(calls,5);failed=true;now+=1800001;const stale=await provider.feed(ids);assert.equal(stale.cities.every(row=>row.status==='cached'),true);assert.equal(stale.cities[0].updatedAt,a.cities[0].updatedAt);assert.equal(stale.cities[0].date,'2026-10-29');
 now=at+25*3600000;const old=await provider.feed(ids);assert.equal(old.cities[0].status,'unavailable');assert.equal(old.cities[0].minimum,null);
 await assert.rejects(()=>provider.feed(['https://internal']));await assert.rejects(()=>provider.feed([ids[0],ids[0]]));
});
test('IBGE search normalizes accents, includes state and does not confuse Pacatuba SE with CE',async()=>{
 let calls=0;const rows=[{id:'2804904',name:'Pacatuba',state:'SE'},{id:'2309706',name:'Pacatuba',state:'CE'},{id:'2803401',name:'Japoatã',state:'SE'}];
 const provider=createWeatherProvider({now:()=>at,fetchImpl:async()=>{calls++;return Response.json(rows.map(city=>({'municipio-id':Number(city.id),'municipio-nome':city.name,'UF-sigla':city.state})));}});
 assert.deepEqual(await provider.search('Pacatuba SE'),[rows[0]]);assert.deepEqual(await provider.search('Japoata'),[rows[2]]);assert.equal((await provider.search('Pacatuba')).length,2);assert.equal(calls,1);
});
test('headline time derives from each news-slide duration and its real article count',()=>{
 assert.equal(headlineIntervalMs(60000,10),6000);assert.equal(headlineIntervalMs(120000,10),12000);assert.equal(headlineIntervalMs(300000,5),60000);assert.equal(headlineIntervalMs(60000,8),7500);
 for(const [duration,count] of [[0,10],[60000,0],[NaN,10],[60000,1.5]])assert.equal(headlineIntervalMs(duration,count),null);
 assert.equal(usableNewsImage('https://www.youtube.com/embed/test'),false);assert.equal(usableNewsImage('https://cdn.example.com/photo.jpg'),true);assert.equal(usableNewsImage(null),false);
});
