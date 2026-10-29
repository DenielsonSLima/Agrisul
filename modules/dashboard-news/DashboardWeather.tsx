'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {useQuery} from '@tanstack/react-query';
import {CloudSun,ChevronLeft,ChevronRight,Loader2,Plus,Search,Settings2,Trash2} from 'lucide-react';
import {DashboardPopover} from '@/modules/resumo/components/DashboardControls';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {authenticatedFetch} from '@/shared/supabase/rpc';
import {billingKeys} from '@/shared/query/keys';
import {notifications} from '@/shared/feedback';
import {DEFAULT_WEATHER_CITIES,weatherCitiesFromResponse,type WeatherCity} from './weatherCatalog';
import {useDashboardWeather} from './useDashboardWeather';
import {WeatherIcon} from './WeatherIcon';
const narrowQuery='(max-width: 760px)';
const narrowSnapshot=()=>window.matchMedia(narrowQuery).matches;
const narrowServerSnapshot=()=>false;
function subscribeNarrow(changed:()=>void){const media=window.matchMedia(narrowQuery);media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);}

export function DashboardWeather({presenting,slideDurationMs}:{presenting:boolean;slideDurationMs:number}){
 const model=useDashboardWeather(),[open,setOpen]=useState(false),[page,setPage]=useState(0),[capacity,setCapacity]=useState(5),trigger=useRef<HTMLButtonElement>(null),citiesRef=useRef<HTMLDivElement>(null);
 const narrow=useSyncExternalStore(subscribeNarrow,narrowSnapshot,narrowServerSnapshot),pageSize=narrow?2:capacity;
 const pages=Math.max(1,Math.ceil(model.cities.length/pageSize)),current=Math.min(page,pages-1);
 const close=useCallback(()=>setOpen(false),[]);
 useEffect(()=>{
  const node=citiesRef.current;if(!node)return;
  const observer=new ResizeObserver(entries=>{const box=entries[0]?.contentRect;if(box)setCapacity(Math.max(1,Math.min(20,Math.floor(box.height/(box.width>=175?62:50)))));});
  observer.observe(node);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{if(!presenting||open||pages<2)return;const timer=window.setTimeout(()=>setPage((current+1)%pages),slideDurationMs/pages);return()=>window.clearTimeout(timer);},[presenting,open,current,pages,slideDurationMs]);
 return <aside className="dashboard-weather" data-dashboard-card aria-label="Previsão do tempo nas cidades selecionadas">
  <header><div><CloudSun size={16}/><h4>Clima</h4></div><button ref={trigger} type="button" aria-label="Configurar cidades do clima" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Settings2 size={14}/></button></header>
  <div ref={citiesRef} className="dashboard-weather-cities" data-city-capacity={pageSize}>{model.cities.slice(current*pageSize,current*pageSize+pageSize).map(city=>{
   const forecast=model.data?.cities.find(item=>item.city.id===city.id),condition=forecast?.condition??'';
   return <article key={city.id} className={forecast?.status==='cached'?'is-stale':''} title={condition||'Consultando previsão'}><div><h5>{forecast?.city.name??city.name}<small>{forecast?.city.state??city.state}</small></h5><p>{model.isPending?'Consultando…':condition||'Previsão indisponível'}</p><span><small>Mín.</small><b>{forecast?.minimum!==null&&forecast?.minimum!==undefined?`${forecast.minimum}°`:'—'}</b><small>Máx.</small><strong>{forecast?.maximum!==null&&forecast?.maximum!==undefined?`${forecast.maximum}°`:'—'}</strong></span></div><WeatherIcon condition={condition}/>{forecast?.status==='cached'&&<em>Referência: {forecast.date?.split('-').reverse().slice(0,2).join('/')}</em>}</article>;
  })}{!model.cities.length&&<div className="dashboard-weather-empty"><CloudSun size={26}/><p>Adicione uma cidade nas configurações.</p></div>}</div>
  <footer><a href="https://portal.inmet.gov.br/" target="_blank" rel="noopener noreferrer">INMET · mín. / máx.</a>{pages>1&&<nav aria-label="Páginas de cidades"><span>{current+1}/{pages}</span><button type="button" aria-label="Cidades anteriores" onClick={()=>setPage((current+pages-1)%pages)}><ChevronLeft size={12}/></button><button type="button" aria-label="Próximas cidades" onClick={()=>setPage((current+1)%pages)}><ChevronRight size={12}/></button></nav>}</footer>
  {open&&<DashboardPopover id="dashboard-weather-settings" title="Cidades do clima" onClose={close} onReturnFocus={()=>trigger.current?.focus({preventScroll:true})}><WeatherSettings cities={model.cities} save={model.saveCities}/></DashboardPopover>}
 </aside>;
}
function WeatherSettings({cities,save}:{cities:WeatherCity[];save:(cities:WeatherCity[])=>boolean}){
 const {user}=useAuth(),[search,setSearch]=useState(''),[debounced,setDebounced]=useState('');
 useEffect(()=>{const timer=window.setTimeout(()=>setDebounced(search.trim()),300);return()=>window.clearTimeout(timer);},[search]);
 const query=useQuery({queryKey:[...billingKeys.resource(user?.id??'','weather-city-search'),{q:debounced}],enabled:!!user&&debounced.length>=2,
  queryFn:async({signal})=>{const response=await authenticatedFetch(`/api/dashboard-weather?q=${encodeURIComponent(debounced)}`,{signal});if(!response.ok)throw Error('Não foi possível buscar cidades.');const cities=weatherCitiesFromResponse(await response.json());if(!cities)throw Error('Busca de cidades inválida.');return cities;},staleTime:86400000,
 });
 const apply=(next:WeatherCity[],message:string)=>{const persisted=save(next);if(persisted)notifications.saved(message);else notifications.error('A alteração foi aplicada nesta sessão; não foi possível salvar neste navegador.');};
 return <div className="weather-settings"><p>Escolha as cidades exibidas neste navegador.</p><label className="weather-search"><Search size={14}/><input autoComplete="off" aria-label="Buscar cidade do Brasil" placeholder="Buscar cidade do Brasil…" value={search} onChange={event=>setSearch(event.target.value)}/>{query.isFetching&&<Loader2 size={13} className="animate-spin"/>}</label>
  {debounced.length>=2&&<div className="weather-search-results" aria-label="Resultados da busca">{query.error?<p role="alert">{query.error.message}</p>:query.data?.length?query.data.map(city=>{const added=cities.some(current=>current.id===city.id);return <button type="button" key={city.id} disabled={added||cities.length>=20} onClick={()=>{apply([...cities,city],`${city.name} adicionada ao clima.`);setSearch('');}}><span>{city.name}<small>{city.state}</small></span>{added?<small>Adicionada</small>:<Plus size={14}/>}</button>;}):!query.isFetching&&<p>Nenhuma cidade encontrada.</p>}</div>}
  <div className="weather-selected-cities">{cities.map(city=><div key={city.id}><span>{city.name}<small>{city.state}</small></span><button type="button" aria-label={`Remover ${city.name} do clima`} onClick={()=>apply(cities.filter(current=>current.id!==city.id),`${city.name} removida do clima.`)}><Trash2 size={14}/></button></div>)}</div>
  <button className="weather-restore" type="button" onClick={()=>apply(DEFAULT_WEATHER_CITIES.map(city=>({...city})),'Cidades iniciais do clima restauradas.')}>Restaurar cidades iniciais</button>
 </div>;
}
