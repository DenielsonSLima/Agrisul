import {Cloud,Sun,Zap} from 'lucide-react';

export function WeatherIcon({condition}:{condition:string}){
 const text=condition.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const kind=/trovo|tempestade/.test(text)?'storm':/chuva|pancadas|chuvisco/.test(text)?'rain':/muitas nuvens|nublado|encoberto/.test(text)?'cloud':/claro|sol/.test(text)?'sun':/poucas nuvens|parcial|algumas nuvens/.test(text)?'partly':'unknown';
 return <span className={`weather-condition-icon is-${kind}`} aria-hidden="true">
  {(kind==='sun'||kind==='partly')&&<Sun className="weather-icon-sun" strokeWidth={1.6}/>}
  {kind!=='sun'&&<Cloud className="weather-icon-cloud" strokeWidth={1.4}/>}
  {(kind==='rain'||kind==='storm')&&<span className="weather-icon-rain"><i/><i/><i/></span>}
  {kind==='storm'&&<Zap className="weather-icon-lightning" strokeWidth={1.5}/>}
 </span>;
}
