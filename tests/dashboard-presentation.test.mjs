import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const transpile=async path=>ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const settingsUrl=dataUrl(await transpile('../modules/resumo/presentationSettings.ts'));
const {DASHBOARD_SCENES,DASHBOARD_SCENE_IDS,PRESENTATION_INTERVALS,defaultPresentationMinutes,isPresentationMinutes,isDashboardSceneIndex,presentationSettingsKey,readPresentationSettings,serializePresentationSettings,updateSceneMinutes,updateAllSceneMinutes}=await import(settingsUrl);

test('every scene defaults to two minutes and only supported intervals and scene indices are accepted',()=>{
 assert.deepEqual(PRESENTATION_INTERVALS,[1,2,5,10]);assert.equal(DASHBOARD_SCENES.length,5);
 assert.deepEqual(Object.keys(defaultPresentationMinutes()),DASHBOARD_SCENE_IDS);assert.equal(Object.values(defaultPresentationMinutes()).every(value=>value===2),true);
 for(const value of [1,2,5,10])assert.equal(isPresentationMinutes(value),true);
 for(const value of [0,3,-1,Infinity,NaN,'2',null])assert.equal(isPresentationMinutes(value),false);
 for(const value of [-1,0.5,5,Infinity,NaN,'0',null])assert.equal(isDashboardSceneIndex(value),false);
 for(const value of [0,1,2,3,4])assert.equal(isDashboardSceneIndex(value),true);
});
test('preferences serialize by canonical scene ID and partial valid settings fill remaining defaults',()=>{
 const values=updateSceneMinutes(defaultPresentationMinutes(),1,5);values['dashboard-types']=10;
 const raw=serializePresentationSettings(values);assert.deepEqual(readPresentationSettings(raw),values);assert.equal(JSON.parse(raw).version,1);
 const partial=readPresentationSettings(JSON.stringify({version:1,minutesByScene:{'dashboard-general':1}}));
 assert.equal(partial['dashboard-general'],1);assert.equal(partial['dashboard-production'],2);assert.equal(Object.keys(partial).length,5);
 const withUnknown={...values,unknown:999};assert.equal('unknown' in JSON.parse(serializePresentationSettings(withUnknown)).minutesByScene,false);
});
test('malformed JSON, unknown versions, keys and unsupported values never enter presentation state',()=>{
 const defaults=defaultPresentationMinutes();
 const invalid=[null,'','{','[]','null','1','x'.repeat(5001),JSON.stringify({version:2,minutesByScene:{'dashboard-general':1}}),JSON.stringify({version:1,minutesByScene:[],ownerId:'other'}),JSON.stringify({version:1,minutesByScene:{unknown:1}}),JSON.stringify({version:1,minutesByScene:{'dashboard-general':'1'}}),JSON.stringify({version:1,minutesByScene:{'dashboard-general':3}}),'{"version":1,"minutesByScene":{"__proto__":1}}'];
 for(const raw of invalid)assert.deepEqual(readPresentationSettings(raw),defaults,raw);
});
test('editing one scene preserves all others and global compatibility updates all scenes without mutating prior state',()=>{
 const previous=defaultPresentationMinutes();const next=updateSceneMinutes(previous,3,10);
 assert.equal(next['dashboard-contracts'],10);assert.equal(next['dashboard-general'],2);assert.equal(previous['dashboard-contracts'],2);
 for(const index of [-1,5,NaN])assert.equal(updateSceneMinutes(previous,index,1),null);
 assert.equal(updateSceneMinutes(previous,1,3),null);assert.equal(updateAllSceneMinutes(3),null);
 assert.equal(Object.values(updateAllSceneMinutes(5)).every(value=>value===5),true);
});
test('storage keys isolate accounts and require an authenticated user',()=>{
 assert.notEqual(presentationSettingsKey('owner-a'),presentationSettingsKey('owner-b'));
 assert.equal(presentationSettingsKey(null),null);assert.equal(presentationSettingsKey(''),null);
 assert.match(presentationSettingsKey('owner:currency'),/owner%3Acurrency$/);
});

// Execute the actual hook with deterministic React lifecycle and browser adapters.
// This exercises effect dependencies and browser failure handling without waiting minutes.
const fixtures=dataUrl(`
 export const state={user:{id:'owner-a'},slots:[],cursor:0,effects:[],pending:[],timers:new Map(),cleared:[],nextTimer:1};
 export function useAuth(){return {user:state.user,registerLiveDisplay:()=>()=>{}};}
 export function useState(initial){const index=state.cursor++;if(!(index in state.slots))state.slots[index]=typeof initial==='function'?initial():initial;return [state.slots[index],value=>{state.slots[index]=typeof value==='function'?value(state.slots[index]):value;}];}
 export function useMemo(factory){state.cursor++;return factory();}
 export function useCallback(callback){state.cursor++;return callback;}
 export function useSyncExternalStore(_subscribe,snapshot){state.cursor++;return snapshot();}
 export function useEffect(effect,deps){const index=state.cursor++,previous=state.effects[index];if(!previous||deps.length!==previous.deps.length||deps.some((value,i)=>!Object.is(value,previous.deps[i])))state.pending.push(()=>{previous?.cleanup?.();const cleanup=effect();state.effects[index]={deps,cleanup};});}
`);
const {state}=await import(fixtures);
let hookSource=await transpile('../modules/resumo/hooks/useDashboardPresentation.ts');
hookSource=hookSource.replace(/from ['"](?:react|@\/shared\/supabase\/AuthProvider)['"]/g,`from ${JSON.stringify(fixtures)}`)
 .replace(/from ['"]\.\.\/presentationSettings['"]/g,`from ${JSON.stringify(settingsUrl)}`);
const {useDashboardPresentation:evaluatePresentation}=await import(dataUrl(hookSource));
const previousGlobals={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
function storageFixture(){const values=new Map();return {values,blocked:false,getItem(key){if(this.blocked)throw new Error('blocked');return values.get(key)??null;},setItem(key,value){if(this.blocked)throw new Error('blocked');values.set(key,value);}};}
function setup(){
 state.user={id:'owner-a'};state.slots=[];state.effects=[];state.pending=[];state.timers.clear();state.cleared=[];state.nextTimer=1;
 const storage=storageFixture();globalThis.window={localStorage:storage,addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}};
 const root={requestFullscreen:async()=>{globalThis.document.fullscreenElement=root;}};
 globalThis.document={fullscreenElement:null,addEventListener(){},removeEventListener(){},exitFullscreen:async()=>{globalThis.document.fullscreenElement=null;}};
 globalThis.setTimeout=(callback,delay)=>{const id=state.nextTimer++;state.timers.set(id,{callback,delay});return id;};
 globalThis.clearTimeout=id=>{state.cleared.push(id);state.timers.delete(id);};
 const rootRef={current:root};
 const render=()=>{state.cursor=0;state.pending=[];const result=evaluatePresentation(rootRef);for(const effect of state.pending)effect();return result;};
 return {storage,render,restore:()=>{for(const effect of state.effects)effect?.cleanup?.();Object.assign(globalThis,previousGlobals);}};
}
test('per-scene timer advances once using each duration; editing a different scene never resets the active timer',async()=>{
 const fixture=setup();
 try{
  let model=fixture.render();assert.equal(model.minutes,2);await model.startPresentation();model=fixture.render();
  const [timerId,timer]=[...state.timers.entries()][0];assert.equal(timer.delay,120000);
  assert.equal(model.setSceneMinutes(1,5),true);model=fixture.render();assert.equal(model.minutes,2);assert.equal(state.timers.has(timerId),true);assert.equal(state.timers.size,1);
  assert.equal(model.setSceneMinutes(0,1),true);model=fixture.render();assert.equal(state.timers.has(timerId),false);assert.equal([...state.timers.values()][0].delay,60000);
  const next=[...state.timers.entries()][0];state.timers.delete(next[0]);next[1].callback();model=fixture.render();assert.equal(model.scene,1);assert.equal(model.minutes,5);assert.equal([...state.timers.values()][0].delay,300000);
  model.togglePause();model=fixture.render();assert.equal(state.timers.size,0);model.togglePause();model=fixture.render();assert.equal([...state.timers.values()][0].delay,300000);
  model.selectScene(999);model=fixture.render();assert.equal(model.scene,1);model.stopPresentation();fixture.render();assert.equal(state.timers.size,0);
 }finally{fixture.restore();}
});
test('blocked storage applies settings immediately in this tab while keeping account preferences and errors isolated',()=>{
 const fixture=setup();
 try{
  let model=fixture.render();fixture.storage.blocked=true;
  assert.equal(model.setSceneMinutes(0,10),false);model=fixture.render();assert.equal(model.minutes,10);assert.match(model.settingsError,/aplicado nesta sessão/);
  state.user={id:'owner-b'};model=fixture.render();assert.equal(model.minutes,2);assert.equal(model.settingsError,'');assert.equal(Object.values(model.minutesByScene).every(value=>value===2),true);
  state.user={id:'owner-a'};model=fixture.render();assert.equal(model.minutes,10);
  fixture.storage.blocked=false;assert.equal(model.setMinutes(1),true);model=fixture.render();assert.equal(Object.values(model.minutesByScene).every(value=>value===1),true);assert.equal(model.settingsError,'');
  assert.equal(model.setSceneMinutes(8,1),false);model=fixture.render();assert.equal(model.minutes,1);assert.match(model.settingsError,/Escolha/);
 }finally{fixture.restore();}
});
