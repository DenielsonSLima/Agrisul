import test from 'node:test';
import assert from 'node:assert/strict';
import {compactInmetPayload,createWeatherProvider,normalizeInmetForecast} from './weatherProviders.mjs';
import {readWeatherCities,weatherPreferencesKey} from './weatherCatalog.ts';
import {headlineIntervalMs,usableNewsImage} from './presentation.ts';
import {weatherCondition} from './weatherCondition.ts';
import {weatherClock,weatherRefreshDelay,weatherSolarTime} from './weatherTime.mjs';
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

test('partial sky, uncertainty, night metadata and unknown conditions retain their meaning',()=>{
 for(const text of ['Parcialmente nublado','Sol entre nuvens','Sol com muitas nuvens','Poucas nuvens','Nuvens dispersas'])assert.equal(weatherCondition(text).kind,'partly',text);
 assert.equal(weatherCondition('Condições isoladas não classificadas').kind,'unknown','The substring in isoladas must not be mistaken for sol');
 assert.deepEqual(weatherCondition('Muitas nuvens com possibilidade de chuva isolada'),{kind:'rain',possible:true});
 assert.deepEqual(weatherCondition('Muitas nuvens com chuva isolada'),{kind:'rain',possible:false});
 assert.equal(weatherCondition('Pancadas de chuva e trovoadas isoladas').kind,'storm');
 for(const text of ['','Previsão indisponível','Não definido'])assert.equal(weatherCondition(text).kind,'unknown');
 const payload=forecast(defaults[0].id);Object.assign(payload[defaults[0].id]['29/10/2026'].noite,{resumo:'Céu claro',cod_icone:51,nascer:'05:00',ocaso:'17:30'});
 const row=normalizeInmetForecast(payload,defaults[0],Date.parse('2026-10-30T01:00:00Z'));assert.equal(row.period,'noite');assert.equal(row.daylight,false);assert.equal(row.iconCode,'51');
});

test('cached raw forecasts switch turns and daylight immediately without waiting for the TTL',async()=>{
 let now=Date.parse('2026-10-29T14:59:00Z'),calls=0;
 const provider=createWeatherProvider({now:()=>now,fetchImpl:async()=>{calls++;return Response.json(forecast(defaults[0].id));}});
 assert.equal((await provider.feed([defaults[0].id])).cities[0].period,'manha');now+=120000;
 const afternoon=(await provider.feed([defaults[0].id])).cities[0];assert.equal(afternoon.period,'tarde');assert.equal(afternoon.condition,'Chuva à tarde');assert.equal(calls,1);
 now=Date.parse('2026-10-29T20:59:00Z');await provider.feed([defaults[0].id]);now+=120000;
 assert.equal((await provider.feed([defaults[0].id])).cities[0].period,'noite');assert.equal(calls,2);
 const payload=forecast(defaults[0].id);delete payload[defaults[0].id]['29/10/2026'].noite;
 assert.equal(normalizeInmetForecast(payload,defaults[0],now),null,'A missing night must never substitute morning as current');
});

test('refresh timing wakes at noon, night, midnight and municipality sunrise instead of an arbitrary polling phase',()=>{
 assert.equal(weatherSolarTime('04h58'),'04:58');assert.equal(weatherSolarTime('17h26'),'17:26');assert.equal(weatherSolarTime('25h10'),null);
 for(const timestamp of ['2026-10-29T14:59:00Z','2026-10-29T20:59:00Z','2026-10-30T02:59:00Z'])assert.equal(weatherRefreshDelay(Date.parse(timestamp)),60050);
 const time=Date.parse('2026-10-29T07:59:00Z');assert.equal(weatherRefreshDelay(time,[{date:'2026-10-29',sunrise:'05:00',sunset:'17:30'}]),60050);
 assert.equal(weatherClock(Date.parse('2026-10-30T01:00:00Z')).date,'2026-10-29');
 const payload=forecast(defaults[0].id);Object.assign(payload[defaults[0].id]['29/10/2026'].manha,{nascer:'04h58',ocaso:'17h26'});
 const row=normalizeInmetForecast(payload,defaults[0],Date.parse('2026-10-29T08:10:00Z'));assert.equal(row.sunrise,'04:58');assert.equal(row.daylight,true);
});

test('persistent cache survives provider restart, keeps original consultation time and never persists failed forecasts',async()=>{
 let now=at,calls=0,writes=0,stored;
 const store={read:async()=>stored,save:async(id,payload,fetchedAt)=>{writes++;stored={payload,fetchedAt};}};
 const fetchImpl=async()=>{calls++;return Response.json(forecast(defaults[0].id));};
 const first=await createWeatherProvider({now:()=>now,fetchImpl,store}).feed([defaults[0].id]);assert.equal(writes,1);
 now+=1000;const restarted=await createWeatherProvider({now:()=>now,fetchImpl,store}).feed([defaults[0].id]);assert.equal(calls,1);assert.deepEqual(restarted.cities,first.cities);
 now+=1800001;const offline=await createWeatherProvider({now:()=>now,fetchImpl:async()=>{throw Error('offline');},store}).feed([defaults[0].id]);assert.equal(offline.cities[0].status,'cached');assert.equal(writes,1);
 const unavailable=await createWeatherProvider({now:()=>now,fetchImpl:async()=>{throw Error('offline');},store:{read:async()=>null,save:async()=>{throw Error('Must not save fabricated data');}}}).feed([defaults[0].id]);assert.equal(unavailable.cities[0].status,'unavailable');assert.equal(unavailable.cities[0].period,null);
});

test('large INMET icon markup is excluded from persistence without losing conditions or turn metadata',()=>{
 const payload=forecast(defaults[0].id);Object.assign(payload[defaults[0].id]['29/10/2026'].manha,{icone:'x'.repeat(200000),cod_icone:34,nascer:'05:00',ocaso:'17:30'});
 const compact=compactInmetPayload(payload,defaults[0]);assert.ok(JSON.stringify(compact).length<2000);assert.equal(payload[defaults[0].id]['29/10/2026'].manha.icone.length,200000);
 assert.deepEqual(normalizeInmetForecast(compact,defaults[0],at),normalizeInmetForecast(payload,defaults[0],at));
});
