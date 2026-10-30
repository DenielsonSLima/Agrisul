export const DASHBOARD_SCENES=[
 {id:'dashboard-general',label:'Geral'},
 {id:'dashboard-weekly',label:'Semanal'},
 {id:'dashboard-production',label:'Produção e ATR'},
 {id:'dashboard-financial',label:'Faturamento'},
 {id:'dashboard-suppliers',label:'Clientes'},
 {id:'dashboard-contracts',label:'Contrato'},
 {id:'dashboard-types',label:'Tipo'},
 {id:'dashboard-news',label:'Notícias'},
] as const;
// Keep values in minutes to preserve existing browser preferences.
export const PRESENTATION_INTERVALS=[10/60,20/60,30/60,1,2,5,10] as const;
export function formatPresentationInterval(minutes:number){
 return minutes<1?Math.round(minutes*60)+' segundos':minutes+' '+(minutes===1?'minuto':'minutos');
}
export type DashboardSceneId=typeof DASHBOARD_SCENES[number]['id'];
export type PresentationMinutes=typeof PRESENTATION_INTERVALS[number];
export type PresentationMinutesByScene=Record<DashboardSceneId,PresentationMinutes>;
export const DASHBOARD_SCENE_IDS:readonly DashboardSceneId[]=DASHBOARD_SCENES.map(scene=>scene.id);

export function defaultPresentationMinutes():PresentationMinutesByScene{
 return Object.fromEntries(DASHBOARD_SCENES.map(scene=>[scene.id,2])) as PresentationMinutesByScene;
}
export function isPresentationMinutes(value:unknown):value is PresentationMinutes{
 return typeof value==='number'&&PRESENTATION_INTERVALS.some(minutes=>minutes===value);
}
export function isDashboardSceneIndex(value:unknown):value is number{
 return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<DASHBOARD_SCENES.length;
}
export function presentationSettingsKey(userId:string|null|undefined){
 return userId?`billing:dashboard-presentation:v1:${encodeURIComponent(userId)}`:null;
}
export function readPresentationSettings(raw:string|null|undefined):PresentationMinutesByScene{
 const defaults=defaultPresentationMinutes();
 if(!raw||raw.length>5000)return defaults;
 try{
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))return defaults;
  const envelope=value as Record<string,unknown>;
  if(envelope.version!==1||Object.keys(envelope).some(key=>key!=='version'&&key!=='minutesByScene'))return defaults;
  const settings=envelope.minutesByScene;
  if(!settings||typeof settings!=='object'||Array.isArray(settings))return defaults;
  const entries=Object.entries(settings);
  if(entries.some(([id,minutes])=>!DASHBOARD_SCENE_IDS.includes(id as DashboardSceneId)||!isPresentationMinutes(minutes)))return defaults;
  return {...defaults,...settings} as PresentationMinutesByScene;
 }catch{return defaults;}
}
export function serializePresentationSettings(minutesByScene:PresentationMinutesByScene){
 // Write only canonical IDs; unknown caller properties cannot enter storage.
 const values=Object.fromEntries(DASHBOARD_SCENES.map(({id})=>[id,isPresentationMinutes(minutesByScene[id])?minutesByScene[id]:2]));
 return JSON.stringify({version:1,minutesByScene:values});
}
export function updateSceneMinutes(current:PresentationMinutesByScene,index:number,minutes:number):PresentationMinutesByScene|null{
 if(!isDashboardSceneIndex(index)||!isPresentationMinutes(minutes))return null;
 return {...current,[DASHBOARD_SCENES[index].id]:minutes};
}
export function updateAllSceneMinutes(minutes:number):PresentationMinutesByScene|null{
 if(!isPresentationMinutes(minutes))return null;
 return Object.fromEntries(DASHBOARD_SCENES.map(scene=>[scene.id,minutes])) as PresentationMinutesByScene;
}
