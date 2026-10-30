import {Cloud,CloudFog,HelpCircle,Moon,Snowflake,Sun,Zap} from 'lucide-react';
import {weatherCondition} from './weatherCondition';

export function WeatherIcon({condition,daylight=true}:{condition:string;daylight?:boolean}){
 const {kind,possible}=weatherCondition(condition),Light=daylight?Sun:Moon;
 return <span className={`weather-condition-icon is-${kind}${possible?' is-possible':''}${daylight?'':' is-night'}`} aria-hidden="true">
  {(kind==='clear'||kind==='partly')&&<Light className={daylight?'weather-icon-sun':'weather-icon-moon'} strokeWidth={1.6}/>}
  {(kind==='cloud'||kind==='partly'||kind==='rain'||kind==='storm')&&<Cloud className="weather-icon-cloud" strokeWidth={1.4}/>}
  {(kind==='rain'||kind==='storm')&&<span className="weather-icon-rain"><i/><i/><i/></span>}
  {kind==='storm'&&<Zap className="weather-icon-lightning" strokeWidth={1.5}/>}
  {possible&&<span className="weather-icon-possibility">?</span>}
  {kind==='unknown'&&<HelpCircle className="weather-icon-unknown" strokeWidth={1.5}/>}
  {kind==='fog'&&<CloudFog className="weather-icon-cloud" strokeWidth={1.4}/>}
  {kind==='snow'&&<Snowflake className="weather-icon-snow" strokeWidth={1.5}/>}
 </span>;
}
