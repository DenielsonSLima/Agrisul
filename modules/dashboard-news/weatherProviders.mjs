import {weatherClock,weatherDaylight,weatherSolarTime} from './weatherTime.mjs';
const SOURCE='https://apiprevmet3.inmet.gov.br/previsao/';
const CITY_SOURCE='https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado&orderBy=nome';
const DEFAULTS=[{id:'2803302',name:'Japaratuba',state:'SE'},{id:'2803401',name:'Japoatã',state:'SE'},{id:'2704302',name:'Maceió',state:'AL'},{id:'2804904',name:'Pacatuba',state:'SE'},{id:'2927408',name:'Salvador',state:'BA'}];
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const dayFormat=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'});
const numeric=(value,min,max)=>{if(typeof value!=='number'&&!(typeof value==='string'&&value.trim()))return null;const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;};
/** INMET also returns large embedded icon markup; retain only forecast fields. */
export function compactInmetPayload(payload,city){
 const fields=['resumo','temp_min','temp_max','umidade_min','umidade_max','cod_icone','nascer','ocaso','hora'];
 const compact=row=>Object.fromEntries(fields.filter(key=>row?.[key]===null||['string','number'].includes(typeof row?.[key])).map(key=>[key,typeof row[key]==='string'?row[key].slice(0,key==='resumo'?500:80):row[key]]));
 const days=payload?.[city.id];if(!days||typeof days!=='object'||Array.isArray(days))return null;
 return {[city.id]:Object.fromEntries(Object.entries(days).filter(([key])=>/^\d{2}\/\d{2}\/\d{4}$/.test(key)).slice(0,7).map(([day,periods])=>[day,typeof periods?.resumo==='string'?compact(periods):Object.fromEntries(['manha','tarde','noite'].filter(period=>periods?.[period]&&typeof periods[period]==='object').map(period=>[period,compact(periods[period])]))]))};
}
export function normalizeInmetForecast(payload,city,now=Date.now()){
 const day=dayFormat.format(new Date(now)),periods=payload?.[city.id]?.[day];if(!periods)return null;
 const {period:requested}=weatherClock(now),selected=periods[requested]??(typeof periods.resumo==='string'?periods:null),period=selected===periods?'dia':requested;
 if(!selected||typeof selected.resumo!=='string')return null;
 const minimum=numeric(selected.temp_min,-80,70),maximum=numeric(selected.temp_max,-80,70);if(minimum!==null&&maximum!==null&&minimum>maximum)return null;
 const [d,m,y]=day.split('/');
 const sunrise=weatherSolarTime(selected.nascer),sunset=weatherSolarTime(selected.ocaso);
 return {city,date:`${y}-${m}-${d}`,period,daylight:weatherDaylight(now,sunrise,sunset),sunrise,sunset,iconCode:selected.cod_icone===undefined?null:String(selected.cod_icone).slice(0,10),condition:selected.resumo.replace(/<[^>]*>/g,'').slice(0,180),minimum,maximum,humidityMinimum:numeric(selected.umidade_min,0,100),humidityMaximum:numeric(selected.umidade_max,0,100)};
}
export function createWeatherProvider({fetchImpl=globalThis.fetch,now=Date.now,store=null,cityDirectory=[]}={}){
 const cache=new Map(),pending=new Map();let locations=null,locationsAt=0,locationRequest;
 async function allCities(){
  if(locations&&now()-locationsAt<24*3600000)return locations;
  if(locationRequest)return locationRequest;
  locationRequest=Promise.resolve().then(async()=>{
   const response=await fetchImpl(CITY_SOURCE,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Não foi possível consultar as cidades.');
   const data=await response.json();if(!Array.isArray(data)||data.length>10000)throw Error('Lista de cidades inválida.');
   const rows=data.flatMap(row=>/^\d{7}$/.test(String(row['municipio-id']))&&typeof row['municipio-nome']==='string'&&/^[A-Z]{2}$/.test(row['UF-sigla'])?[{id:String(row['municipio-id']),name:row['municipio-nome'],state:row['UF-sigla']}]:[]);
   if(!rows.length)throw Error('Nenhuma cidade disponível.');locations=rows;locationsAt=now();return rows;
  }).finally(()=>{locationRequest=undefined;});
  return locationRequest;
 }
 async function search(query){
  const tokens=normalize(query).split(' ').filter(Boolean);if(!tokens.length)return [];
  const rows=await allCities();return rows.filter(city=>tokens.every(token=>normalize(city.name+' '+city.state).includes(token))).sort((a,b)=>Number(normalize(b.name).startsWith(tokens[0]))-Number(normalize(a.name).startsWith(tokens[0]))||a.name.localeCompare(b.name,'pt-BR')).slice(0,12);
 }
 async function cityById(id){return cityDirectory.find(city=>city.id===id)??DEFAULTS.find(city=>city.id===id)??(await allCities()).find(city=>city.id===id)??null;}
 function forecast(city){
  if(pending.has(city.id))return pending.get(city.id);
  const task=Promise.resolve().then(async()=>{
   let saved=cache.get(city.id);
   if(store&&(!saved||now()-saved.at>=1800000||!normalizeInmetForecast(saved.payload,city,now()))){try{const row=await store.read(city.id);if(row){const at=Date.parse(row.fetchedAt);const data=normalizeInmetForecast(row.payload,city,at);if(data&&Number.isFinite(at)&&at<=now()&&(!saved||at>saved.at)){saved={at,payload:row.payload,data};cache.set(city.id,saved);}}}catch{/* A storage outage must not invent a forecast. */}}
   const current=saved&&normalizeInmetForecast(saved.payload,city,now());
   if(current&&now()-saved.at<1800000)return {...current,status:'current',updatedAt:new Date(saved.at).toISOString()};
   const startedAt=now();
   try{const response=await fetchImpl(SOURCE+city.id,{signal:AbortSignal.timeout(6000),headers:{Accept:'application/json'}});if(!response.ok)throw Error('Previsão indisponível.');
    const payload=compactInmetPayload(await response.json(),city),data=normalizeInmetForecast(payload,city,now());if(!data)throw Error('Previsão de hoje indisponível.');const at=startedAt;cache.set(city.id,{data,at,payload});
    if(store){try{await store.save(city.id,payload,new Date(at).toISOString());}catch{/* The official live response remains usable if persistence fails. */}}
    return {...data,status:'current',updatedAt:new Date(at).toISOString()};
   }catch{if(store?.failed){try{await store.failed(city.id);}catch{}}
    return saved&&now()-saved.at<=24*3600000?{...(current??saved.data),status:'cached',updatedAt:new Date(saved.at).toISOString()}:{city,date:null,period:null,daylight:null,sunrise:null,sunset:null,iconCode:null,condition:'Previsão indisponível',minimum:null,maximum:null,humidityMinimum:null,humidityMaximum:null,status:'unavailable',updatedAt:null};}
  }).finally(()=>pending.delete(city.id));pending.set(city.id,task);return task;
 }
 async function cities(ids){
  if(!Array.isArray(ids)||ids.length>20||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^\d{7}$/.test(id)))throw Error('Selecione até 20 cidades válidas.');
  const rows=await Promise.all(ids.map(cityById));if(rows.some(city=>!city))throw Error('Cidade não encontrada no IBGE.');return rows;
 }
 async function feed(ids){return {cities:await Promise.all((await cities(ids)).map(forecast)),checkedAt:new Date(now()).toISOString(),refreshSeconds:1800,source:'INMET'};}
 return {search,cities,feed};
}
const provider=createWeatherProvider();
export const getWeatherFeed=ids=>provider.feed(ids);
export const searchWeatherCities=query=>provider.search(query);
