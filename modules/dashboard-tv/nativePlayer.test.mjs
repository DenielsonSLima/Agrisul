import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const fixtureUrl=dataUrl(`
 export const state={slots:[],cursor:0,effects:[],pending:[],engines:[],calls:[],active:[],user:{id:'viewer'},session:{user:{id:'viewer'},access_token:'test-access-token'},response:null,video:null,feed:null};
 export function useRef(value){const i=state.cursor++;if(!(i in state.slots))state.slots[i]={current:i===0?state.video:value};return state.slots[i];}
 export function useState(value){const i=state.cursor++;if(!(i in state.slots))state.slots[i]=typeof value==='function'?value():value;return [state.slots[i],next=>{state.slots[i]=typeof next==='function'?next(state.slots[i]):next;}];}
 export function useMemo(factory){state.cursor++;return factory();}
 export function useEffect(effect,deps){const i=state.cursor++,previous=state.effects[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index])))state.pending.push(()=>{previous?.cleanup?.();state.effects[i]={deps,cleanup:effect()};});}
 export const jsx=(type,props)=>({type,props}),jsxs=jsx;
 export const ExternalLink='icon',Loader2='icon',Play='icon',Pause='icon',Volume2='icon',VolumeX='icon',Maximize='icon',RefreshCw='icon',ChevronLeft='icon',ChevronRight='icon',Tv='icon',NativeDashPlayer='native-player';
 export const TV_CHANNELS=[{id:'canal-rural',name:'Canal Rural'}],useDashboardTv=()=>state.feed;
 export const useAuth=()=>({user:state.user});
 export const getSupabaseBrowserClient=()=>({auth:{getSession:async()=>({data:{session:state.session},error:null})}});
 export async function authenticatedFetch(path,options){state.calls.push({path,options});return state.response??Response.json({manifest:'<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet><Representation><BaseURL>/api/dashboard-tv/stream?videoId=testvideo01&amp;itag=137</BaseURL></Representation></AdaptationSet></Period></MPD>'});}
 export function MediaPlayer(){return{create(){const engine={events:new Map(),resetCount:0,settingsHistory:[],updateSettings(settings){this.settings=settings;this.settingsHistory.push(settings);},addRequestInterceptor(callback){this.intercept=callback;},on(name,callback){this.events.set(name,callback);},initialize(video,url,autoplay){this.initialized={video,url,autoplay};},attachSource(url){this.initialized.url=url;},reset(){this.resetCount++;}};state.engines.push(engine);return engine;}};}
 MediaPlayer.events={ERROR:'error',PLAYBACK_NOT_ALLOWED:'blocked'};
`);
const {state}=await import(fixtureUrl);
const manifestSource=ts.transpileModule(await readFile(new URL('./nativeManifest.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const manifestUrl=dataUrl(manifestSource),{nativeManifest}=await import(manifestUrl);
let source=ts.transpileModule(await readFile(new URL('./NativeDashPlayer.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
source=source.replace(/import ['"]\.\/nativePlayer\.css['"];?/g,'').replace(/from ['"](?:react(?:\/jsx-runtime)?|lucide-react|@\/shared\/supabase\/(?:AuthProvider|client|rpc))['"]/g,`from ${JSON.stringify(fixtureUrl)}`).replace(/from ['"]\.\/nativeManifest['"]/g,`from ${JSON.stringify(manifestUrl)}`).replace(/import\(['"]dashjs['"]\)/g,`import(${JSON.stringify(fixtureUrl)})`);
const {NativeDashPlayer}=await import(dataUrl(source));
let dashboardSource=ts.transpileModule(await readFile(new URL('./DashboardTv.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
dashboardSource=dashboardSource.replace(/import ['"]\.\/tv\.css['"];?/g,'').replace(/from ['"](?:react(?:\/jsx-runtime)?|lucide-react|\.\/(?:catalog|useDashboardTv|NativeDashPlayer))['"]/g,`from ${JSON.stringify(fixtureUrl)}`);
const {DashboardTv}=await import(dataUrl(dashboardSource));
const previousWindow=globalThis.window;
function setup(overrides={}){
 state.slots=[];state.cursor=0;state.effects=[];state.pending=[];state.engines=[];state.calls=[];state.active=[];state.response=null;
 state.user={id:'viewer'};state.session={user:{id:'viewer'},access_token:'test-access-token'};
 const video=new EventTarget();video.paused=true;video.pause=()=>{video.paused=true;video.dispatchEvent(new Event('pause'));};video.play=()=>{video.paused=false;video.dispatchEvent(new Event('play'));video.dispatchEvent(new Event('playing'));return Promise.resolve();};video.removeAttribute=()=>{};video.load=()=>{};state.video=video;
 globalThis.window={location:{origin:'https://dashboard.example'},MediaSource:function(){}};
 let props={videoId:'testvideo01',title:'Notícias do agro',autoplay:true,paused:false,onActiveChange:active=>state.active.push(active),...overrides};
 const render=changes=>{props={...props,...changes};state.cursor=0;state.pending=[];const view=NativeDashPlayer(props);for(const effect of state.pending)effect();return view;};
 const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
 return {video,render,settle,cleanup(){for(const effect of state.effects)effect?.cleanup?.();globalThis.window=previousWindow;}};
}
function descendants(node){if(!node||typeof node!=='object')return[];const children=Array.isArray(node.props?.children)?node.props.children:[node.props?.children];return[node,...children.flatMap(descendants)];}

test('preview waits for a click; loading metadata never reports playback active',async()=>{
 const fixture=setup({autoplay:false});
 try{
  let view=fixture.render();await fixture.settle();assert.equal(state.calls.length,0);assert.equal(state.engines.length,0);
  descendants(view).find(node=>node.type==='button').props.onClick();view=fixture.render();await fixture.settle();
  assert.equal(state.calls.length,1);assert.equal(state.engines.length,1);assert.equal(state.active.includes(true),false);
  assert.equal(state.calls[0].path,'/api/dashboard-tv/playback?videoId=testvideo01');assert.equal(state.calls[0].options.cache,'no-store');
  fixture.video.dispatchEvent(new Event('waiting'));assert.equal(state.active.includes(true),false);
  await fixture.video.play();assert.equal(state.active.at(-1),true);
 }finally{fixture.cleanup();}
});

test('DASH preserves byte ranges and reads the current account session for every media request',async()=>{
 const fixture=setup();
 try{
  fixture.render();await fixture.settle();const engine=state.engines[0];
  assert.match(engine.initialized.url,/^blob:/);assert.equal(engine.initialized.autoplay,true);
  assert.equal(engine.settings.streaming.scheduling.scheduleWhilePaused,true,'Bootstrap buffering must run before native CAN_PLAY can trigger autoplay');
  const manifest=await(await fetch(engine.initialized.url)).text();assert.match(manifest,/<BaseURL>https:\/\/dashboard\.example\/api\/dashboard-tv\/stream\?videoId=testvideo01&amp;itag=137<\/BaseURL>/);
  const request={url:'https://dashboard.example/api/dashboard-tv/stream?videoId=testvideo01&itag=137',headers:{Range:'bytes=0-1500'}};
  const authorized=await engine.intercept(request);assert.equal(authorized.headers.Range,'bytes=0-1500');assert.equal(authorized.headers.Authorization,'Bearer test-access-token');assert.equal(authorized.url.includes('test-access-token'),false);
  state.session={user:{id:'viewer'},access_token:'refreshed-access-token'};
  const refreshed=await engine.intercept({...request,headers:{Range:'bytes=1501-3000'}});assert.equal(refreshed.headers.Authorization,'Bearer refreshed-access-token');
 }finally{fixture.cleanup();}
});

test('unexpected destinations and account switches stop playback without leaking bearer credentials',async()=>{
 for(const switched of [false,true]){
  const fixture=setup();
  try{
   fixture.render();await fixture.settle();const engine=state.engines[0];
   if(switched)state.session={user:{id:'other-account'},access_token:'other-account-token'};
   const denied=await engine.intercept({url:switched?'https://dashboard.example/api/dashboard-tv/stream?videoId=testvideo01&itag=137':'https://untrusted.example/media',headers:{Range:'bytes=0-500'}});
   assert.equal(denied.url,'data:application/octet-stream;base64,');assert.deepEqual(denied.headers,{});assert.equal(state.active.at(-1),false);
   await fixture.settle();assert.equal(engine.resetCount,0,'An error must not reset models while DASH track creation promises are in flight');
   assert.equal(engine.settings.streaming.scheduling.scheduleWhilePaused,false);
   assert.equal(state.calls[0].options.signal.aborted,true);
   const view=fixture.render();assert.ok(descendants(view).some(node=>node.props?.role==='alert'));
  }finally{fixture.cleanup();}
 }
});

test('pause, resume, ended and cleanup follow actual native media state',async()=>{
 let ended=0;const fixture=setup({onEnded:()=>ended++});
 try{
  fixture.render();await fixture.settle();const engine=state.engines[0];
  await fixture.video.play();assert.equal(state.active.at(-1),true);
  fixture.render({paused:true});assert.equal(fixture.video.paused,true);assert.equal(state.active.at(-1),false);
  assert.equal(engine.settings.streaming.scheduling.scheduleWhilePaused,false);
  fixture.render({paused:false});await fixture.settle();assert.equal(fixture.video.paused,false);assert.equal(state.active.at(-1),true);
  assert.equal(engine.settings.streaming.scheduling.scheduleWhilePaused,true);
  fixture.video.dispatchEvent(new Event('ended'));assert.equal(ended,1);assert.equal(state.active.at(-1),false);
  fixture.cleanup();assert.equal(engine.resetCount,1);assert.equal(state.calls[0].options.signal.aborted,true);
 }finally{fixture.cleanup();}
});

test('Blob manifests use absolute authenticated endpoints and reject unexpected media paths',()=>{
 const wrap=url=>`<MPD><Period><BaseURL>${url}</BaseURL></Period></MPD>`;
 const path='/api/dashboard-tv/stream?videoId=testvideo01&amp;itag=137';
 assert.equal(nativeManifest(wrap(path),'https://dashboard.example','testvideo01'),wrap(`https://dashboard.example${path}`));
 for(const bad of ['https://foreign.example'+path,'/api/other?videoId=testvideo01&amp;itag=137','/api/dashboard-tv/stream?videoId=other-video&amp;itag=137',path+'&amp;token=forbidden',path.replace('137','invalid')])assert.throws(()=>nativeManifest(wrap(bad),'https://dashboard.example','testvideo01'));
 assert.throws(()=>nativeManifest('<MPD></MPD>','https://dashboard.example','testvideo01'));
});

test('autoplay skips unavailable videos at most five times and manual navigation resets its budget',()=>{
 const fixture=setup();
 try{
  state.feed={isPending:false,isFetching:false,data:{sources:[],videos:Array.from({length:7},(_,index)=>({id:`testvideo0${index}`,channelId:'canal-rural',channelName:'Canal Rural',title:`Vídeo ${index}`,publishedAt:'2026-10-30T12:00:00Z',thumbnailUrl:'',url:''}))}};
  const render=()=>{state.cursor=0;state.pending=[];const view=DashboardTv({settings:{mode:'autoplay',channelIds:['canal-rural']},presenting:true,paused:false});for(const effect of state.pending)effect();return view;};
  let view=render();
  const current=()=>descendants(view).find(node=>node.type==='native-player');
  for(let index=0;index<5;index++){
   assert.equal(current().props.videoId,`testvideo0${index}`);current().props.onUnavailable();view=render();
  }
  assert.equal(current().props.videoId,'testvideo04');assert.ok(descendants(view).some(node=>node.props?.className==='dashboard-tv-playback-note'));
  current().props.onUnavailable();view=render();assert.equal(current().props.videoId,'testvideo04');
  descendants(view).find(node=>node.type==='button'&&node.props?.['aria-label']==='Próximo vídeo').props.onClick();view=render();assert.equal(current().props.videoId,'testvideo05');
  assert.equal(descendants(view).some(node=>node.props?.className==='dashboard-tv-playback-note'),false);
  current().props.onUnavailable();view=render();assert.equal(current().props.videoId,'testvideo06');
 }finally{fixture.cleanup();}
});
