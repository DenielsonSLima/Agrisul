export type WeatherCity={id:string;name:string;state:string};
export type CityForecast={city:WeatherCity;date:string|null;condition:string;minimum:number|null;maximum:number|null;humidityMinimum:number|null;humidityMaximum:number|null;status:'current'|'cached'|'unavailable';updatedAt:string|null};
export type WeatherFeed={cities:CityForecast[];checkedAt:string;refreshSeconds:number;source:'INMET'};
export const DEFAULT_WEATHER_CITIES:readonly WeatherCity[]=[
 {id:'2803302',name:'Japaratuba',state:'SE'},
 {id:'2803401',name:'Japoatã',state:'SE'},
 {id:'2704302',name:'Maceió',state:'AL'},
 {id:'2804904',name:'Pacatuba',state:'SE'},
 {id:'2927408',name:'Salvador',state:'BA'},
];
export function weatherPreferencesKey(userId:string|null|undefined){return userId?`billing:dashboard-weather:v1:${encodeURIComponent(userId)}`:null;}
export function isWeatherCity(value:unknown):value is WeatherCity{
 if(!value||typeof value!=='object')return false;const city=value as Record<string,unknown>;
 return typeof city.id==='string'&&/^\d{7}$/.test(city.id)&&typeof city.name==='string'&&city.name.length>=2&&city.name.length<=100&&typeof city.state==='string'&&/^[A-Z]{2}$/.test(city.state);
}
export function weatherCitiesFromResponse(value:unknown):WeatherCity[]|null{
 if(!value||typeof value!=='object')return null;const cities=(value as Record<string,unknown>).cities;
 return Array.isArray(cities)&&cities.length<=20&&cities.every(isWeatherCity)?cities:null;
}
export function isWeatherFeed(value:unknown):value is WeatherFeed{
 if(!value||typeof value!=='object')return false;const feed=value as Record<string,unknown>;
 if(feed.source!=='INMET'||typeof feed.checkedAt!=='string'||!Number.isFinite(Date.parse(feed.checkedAt))||typeof feed.refreshSeconds!=='number'||!Array.isArray(feed.cities)||feed.cities.length>20)return false;
 return feed.cities.every(row=>row&&typeof row==='object'&&isWeatherCity(row.city)&&typeof row.condition==='string'&&['current','cached','unavailable'].includes(row.status)&&(row.minimum===null||typeof row.minimum==='number'&&Number.isFinite(row.minimum))&&(row.maximum===null||typeof row.maximum==='number'&&Number.isFinite(row.maximum))&&(row.date===null||typeof row.date==='string')&&(row.updatedAt===null||typeof row.updatedAt==='string'));
}
export function readWeatherCities(raw:string|null|undefined):WeatherCity[]{
 const defaults=()=>DEFAULT_WEATHER_CITIES.map(city=>({...city}));
 if(!raw||raw.length>10000)return defaults();
 try{const envelope=JSON.parse(raw);if(envelope?.version!==1||!Array.isArray(envelope.cities)||envelope.cities.length>20)return defaults();
  const cities=envelope.cities as WeatherCity[];
  if(!cities.every(isWeatherCity)||new Set(cities.map(city=>city.id)).size!==cities.length)return defaults();
  return cities.map(({id,name,state})=>({id,name,state}));
 }catch{return defaults();}
}
