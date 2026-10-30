'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {useQuery} from '@tanstack/react-query';
import {CloudSun,ChevronLeft,ChevronRight,Loader2,Plus,Search,Settings2,Trash2} from 'lucide-react';
import {DashboardPopover} from '@/modules/resumo/components/DashboardControls';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {authenticatedFetch} from '@/shared/supabase/rpc';
import {billingKeys} from '@/shared/query/keys';
import {notifications} from '@/shared/feedback';
import {weatherCitiesFromResponse,weatherPeriodLabel,type CityForecast,type WeatherCity} from './weatherCatalog';
import {weatherClock} from './weatherTime.mjs';
import {useDashboardWeather} from './useDashboardWeather';
import {WeatherIcon} from './WeatherIcon';
const narrowQuery='(max-width: 760px)';
const narrowSnapshot=()=>window.matchMedia(narrowQuery).matches;
const narrowServerSnapshot=()=>false;
function subscribeNarrow(changed:()=>void){const media=window.matchMedia(narrowQuery);media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);}

export function DashboardWeather({presenting,slideDurationMs}:{presenting:boolean;slideDurationMs:number}){
 const model=useDashboardWeather(),[open,setOpen]=useState(false),[detail,setDetail]=useState<WeatherCity|null>(null),[page,setPage]=useState(0),[capacity,setCapacity]=useState(5),trigger=useRef<HTMLButtonElement>(null),detailTrigger=useRef<HTMLButtonElement|null>(null),citiesRef=useRef<HTMLDivElement>(null);
 const narrow=useSyncExternalStore(subscribeNarrow,narrowSnapshot,narrowServerSnapshot),pageSize=narrow?2:capacity;
 const pages=Math.max(1,Math.ceil(model.cities.length/pageSize)),current=Math.min(page,pages-1);
 const close=useCallback(()=>setOpen(false),[]);
 const closeDetail=useCallback(()=>setDetail(null),[]);
 useEffect(()=>{
  const node=citiesRef.current;if(!node)return;
  const observer=new ResizeObserver(entries=>{const box=entries[0]?.contentRect;if(box)setCapacity(Math.max(1,Math.min(20,Math.floor(box.height/(box.width>=175?78:66)))));});
  observer.observe(node);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{if(!presenting||open||detail||pages<2)return;const timer=window.setTimeout(()=>setPage((current+1)%pages),slideDurationMs/pages);return()=>window.clearTimeout(timer);},[presenting,open,detail,current,pages,slideDurationMs]);
 return <aside className="dashboard-weather" data-dashboard-card aria-label="Previsão do tempo nas cidades selecionadas">
  <header><div><CloudSun size={16}/><h4>Previsão</h4></div><button ref={trigger} type="button" aria-label="Configurar cidades do clima" aria-expanded={open} onClick={()=>{closeDetail();setOpen(value=>!value);}}><Settings2 size={14}/></button></header>
  <div ref={citiesRef} className="dashboard-weather-cities" data-city-capacity={pageSize}>{model.cities.slice(current*pageSize,current*pageSize+pageSize).map(city=>{
   const forecast=model.data?.cities.find(item=>item.city.id===city.id),condition=forecast?.condition??'';
   const stale=forecast?.status==='cached'||model.isError;
   return <article key={city.id} className={stale?'is-stale':''} title={condition||'Consultando previsão'}><div><h5><button type="button" className="weather-city-details" aria-label={`Ver previsão completa de ${city.name}`} aria-haspopup="dialog" aria-expanded={detail?.id===city.id} onClick={event=>{detailTrigger.current=event.currentTarget;close();setDetail(city);}}>{forecast?.city.name??city.name}<small>{forecast?.city.state??city.state}</small></button></h5><small className="weather-forecast-period">{forecast?.date?`${stale?'Referência: ':''}${forecast.date===weatherClock().date?'Hoje':forecast.date.split('-').reverse().slice(0,2).join('/')} · ${weatherPeriodLabel(forecast.period)}`:'Previsão por turno'}</small><p>{model.isPending?'Consultando…':condition||'Previsão indisponível'}</p><span><small>Mín.</small><b>{forecast?.minimum!==null&&forecast?.minimum!==undefined?`${forecast.minimum}°`:'—'}</b><small>Máx.</small><strong>{forecast?.maximum!==null&&forecast?.maximum!==undefined?`${forecast.maximum}°`:'—'}</strong></span></div><WeatherIcon condition={condition} daylight={forecast?.daylight??false}/></article>;
  })}{!model.cities.length&&<div className="dashboard-weather-empty"><CloudSun size={26}/><p>{model.preferencesLoading?'Carregando suas cidades…':model.preferencesError||'Adicione uma cidade nas configurações.'}</p>{model.preferencesError&&<button type="button" onClick={()=>void model.reloadPreferences()}>Tentar novamente</button>}</div>}</div>
  <footer><a href="https://portal.inmet.gov.br/" target="_blank" rel="noopener noreferrer">INMET · previsão</a>{pages>1&&<nav aria-label="Páginas de cidades"><span>{current+1}/{pages}</span><button type="button" aria-label="Cidades anteriores" onClick={()=>setPage((current+pages-1)%pages)}><ChevronLeft size={12}/></button><button type="button" aria-label="Próximas cidades" onClick={()=>setPage((current+1)%pages)}><ChevronRight size={12}/></button></nav>}</footer>
  {detail&&<DashboardPopover id="dashboard-weather-detail" title={`${detail.name} · ${detail.state}`} onClose={closeDetail} onReturnFocus={()=>detailTrigger.current?.focus({preventScroll:true})}><WeatherDetail forecast={model.data?.cities.find(row=>row.city.id===detail.id)} failed={model.isError}/></DashboardPopover>}
  {open&&<DashboardPopover id="dashboard-weather-settings" title="Cidades do clima" onClose={close} onReturnFocus={()=>trigger.current?.focus({preventScroll:true})}><WeatherSettings cities={model.cities} change={model.changeCities} busy={model.isSaving||model.preferencesLoading||!!model.preferencesError}/></DashboardPopover>}
 </aside>;
}
function WeatherDetail({forecast,failed}:{forecast:CityForecast|undefined;failed:boolean}){
 return <div className="weather-detail"><p>Previsão por turno do INMET.</p><strong>{forecast?.condition||'Previsão indisponível'}</strong><dl><div><dt>Validade</dt><dd>{forecast?.date?`${forecast.date.split('-').reverse().join('/')} · ${weatherPeriodLabel(forecast.period)}`:'Indisponível'}</dd></div><div><dt>Mínima / máxima previstas</dt><dd>{forecast?.minimum??'—'}° / {forecast?.maximum??'—'}°</dd></div><div><dt>Consulta ao INMET</dt><dd>{forecast?.updatedAt?new Date(forecast.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Indisponível'}</dd></div></dl><p>Horários de Brasília.{forecast?.status==='cached'||failed?' Atualização indisponível; exibindo a última referência obtida.':''}</p></div>;
}
function WeatherSettings({cities,change,busy}:{cities:WeatherCity[];change:(action:'add'|'remove'|'reset',cityId?:string)=>Promise<unknown>;busy:boolean}){
 const {user}=useAuth(),[search,setSearch]=useState(''),[debounced,setDebounced]=useState(''),[error,setError]=useState(''),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{const timer=window.setTimeout(()=>setDebounced(search.trim()),300);return()=>window.clearTimeout(timer);},[search]);
 const query=useQuery({queryKey:[...billingKeys.resource(user?.id??'','weather-city-search'),{q:debounced,projection:2}],enabled:!!user&&!busy&&debounced.length>=2,
  queryFn:async({signal})=>{const response=await authenticatedFetch(`/api/dashboard-weather?q=${encodeURIComponent(debounced)}`,{signal});if(!response.ok)throw Error('Não foi possível buscar cidades.');const cities=weatherCitiesFromResponse(await response.json());if(!cities)throw Error('Busca de cidades inválida.');return cities;},staleTime:86400000,
 });
 const apply=async(action:'add'|'remove'|'reset',cityId:string|undefined,message:string)=>{setError('');try{await change(action,cityId);if(mounted.current){notifications.saved(message);if(action==='add')setSearch('');}}catch(reason){if(mounted.current){const text=reason instanceof Error?reason.message:'Não foi possível salvar as cidades.';setError(text);notifications.error(text);}}};
 return <div className="weather-settings" aria-busy={busy}><p>Cidades salvas na sua conta e sincronizadas entre seus dispositivos.</p><label className="weather-search"><Search size={14}/><input disabled={busy} autoComplete="off" aria-label="Buscar cidade do Brasil" placeholder="Buscar cidade do Brasil…" value={search} onChange={event=>setSearch(event.target.value)}/>{query.isFetching&&<Loader2 size={13} className="animate-spin"/>}</label>
  {error&&<p role="alert">{error}</p>}
  {debounced.length>=2&&<div className="weather-search-results" aria-label="Resultados da busca">{query.error?<p role="alert">{query.error.message}</p>:query.data?.length?query.data.map(city=>{const added=cities.some(current=>current.id===city.id);return <button type="button" key={city.id} disabled={busy||added||cities.length>=20} onClick={()=>void apply('add',city.id,`${city.name} adicionada ao clima.`)}><span>{city.name}<small>{city.state}</small></span>{added?<small>Adicionada</small>:<Plus size={14}/>}</button>;}):!query.isFetching&&<p>Nenhuma cidade encontrada.</p>}</div>}
  <div className="weather-selected-cities">{cities.map(city=><div key={city.id}><span>{city.name}<small>{city.state}</small></span><button disabled={busy} type="button" aria-label={`Remover ${city.name} do clima`} onClick={()=>void apply('remove',city.id,`${city.name} removida do clima.`)}><Trash2 size={14}/></button></div>)}</div>
  <button disabled={busy} className="weather-restore" type="button" onClick={()=>void apply('reset',undefined,'Cidades iniciais do clima restauradas.')}>{busy?'Salvando…':'Restaurar cidades iniciais'}</button>
 </div>;
}
