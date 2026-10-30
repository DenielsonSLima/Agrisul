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
export type DashboardPresentationPreferences={minutesByScene:PresentationMinutesByScene;enabledSceneIds:DashboardSceneId[]};
export function defaultDashboardPreferences():DashboardPresentationPreferences{
 return {minutesByScene:defaultPresentationMinutes(),enabledSceneIds:[...DASHBOARD_SCENE_IDS]};
}

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
export function readDashboardPreferences(raw:string|null|undefined):DashboardPresentationPreferences{
 const defaults=defaultDashboardPreferences();
 if(!raw||raw.length>5000)return defaults;
 try{
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))return defaults;
  const envelope=value as Record<string,unknown>;
  if(envelope.version!==1&&envelope.version!==2&&envelope.version!==3)return defaults;
  const legacy=envelope.version!==3;
  const allowed=envelope.version===1?['version','minutesByScene']:envelope.version===2?['version','minutesByScene','enabledSceneIds','tvSettings']:['version','minutesByScene','enabledSceneIds'];
  if(Object.keys(envelope).some(key=>!allowed.includes(key)))return defaults;
  const settings=envelope.minutesByScene;
  if(!settings||typeof settings!=='object'||Array.isArray(settings))return defaults;
  const entries=Object.entries(settings);
  // Ignore the retired scene while preserving the remaining saved preferences.
  const retiredId='dashboard-tv';
  if(entries.some(([id,minutes])=>(!DASHBOARD_SCENE_IDS.includes(id as DashboardSceneId)&&!(legacy&&id===retiredId))||!isPresentationMinutes(minutes)))return defaults;
  const minutesByScene=Object.fromEntries(DASHBOARD_SCENE_IDS.map(id=>[id,(settings as Record<string,unknown>)[id]??defaults.minutesByScene[id]])) as PresentationMinutesByScene;
  if(envelope.version===1)return {...defaults,minutesByScene};
  let enabledSceneIds=envelope.enabledSceneIds;
  if(legacy&&Array.isArray(enabledSceneIds)){
   const remaining=enabledSceneIds.filter(id=>id!==retiredId);
   enabledSceneIds=remaining.length||!enabledSceneIds.length?remaining:['dashboard-general'];
  }
  const candidate={minutesByScene,enabledSceneIds};
  return validateDashboardPreferences(candidate)??defaults;
 }catch{return defaults;}
}
export function readPresentationSettings(raw:string|null|undefined):PresentationMinutesByScene{
 return readDashboardPreferences(raw).minutesByScene;
}
export function validateDashboardPreferences(value:unknown):DashboardPresentationPreferences|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const input=value as Record<string,unknown>,minutes=input.minutesByScene,enabled=input.enabledSceneIds;
 if(!minutes||typeof minutes!=='object'||Array.isArray(minutes)||!DASHBOARD_SCENE_IDS.every(id=>isPresentationMinutes((minutes as Record<string,unknown>)[id])))return null;
 if(!Array.isArray(enabled)||!enabled.length||enabled.some(id=>!DASHBOARD_SCENE_IDS.includes(id))||new Set(enabled).size!==enabled.length)return null;
 return {minutesByScene:Object.fromEntries(DASHBOARD_SCENE_IDS.map(id=>[id,(minutes as PresentationMinutesByScene)[id]])) as PresentationMinutesByScene,enabledSceneIds:DASHBOARD_SCENE_IDS.filter(id=>enabled.includes(id))};
}
export function serializeDashboardPreferences(preferences:DashboardPresentationPreferences){
 const validated=validateDashboardPreferences(preferences);
 if(!validated)throw new Error('Preferências do Dashboard inválidas.');
 return JSON.stringify({version:3,...validated});
}
export function presentationSceneIndices(enabled:readonly DashboardSceneId[]){
 return DASHBOARD_SCENES.flatMap((scene,index)=>enabled.includes(scene.id)?[index]:[]);
}
export function nextPresentationScene(current:number,indices:readonly number[]){
 if(!indices.length)return current;
 const position=indices.indexOf(current);
 return indices[(position+1)%indices.length];
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
