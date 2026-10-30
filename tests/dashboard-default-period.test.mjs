import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const transpile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const sharedUrl=dataUrl(transpile('../shared/utils/presentation.ts'));
const periodUrl=dataUrl(transpile('../modules/resumo/defaultPeriod.ts'));
const filtersUrl=dataUrl(transpile('../modules/resumo/filters.ts').replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(sharedUrl)}`).replace(/from ['"]\.\/defaultPeriod['"]/g,`from ${JSON.stringify(periodUrl)}`));
const {defaultRange,rangeDays,validRange}=await import(filtersUrl);
const {DASHBOARD_DEFAULT_PERIODS,DASHBOARD_ROLLING_PERIODS,defaultPeriodKey,readDefaultPeriod,defaultPeriodDescription}=await import(periodUrl);

test('calendar months differ from rolling days and retain calendar boundaries across years',()=>{
 const range=(period,today='2026-10-29')=>{const {from,to}=defaultRange(period,today);return {from,to};};
 assert.deepEqual(range('month'),{from:'2026-10-01',to:'2026-10-29'});
 assert.deepEqual(range('last-30-days'),{from:'2026-09-30',to:'2026-10-29'});
 assert.deepEqual(range('last-3-months'),{from:'2026-08-01',to:'2026-10-29'});
 assert.deepEqual(range('last-90-days'),{from:'2026-08-01',to:'2026-10-29'});
 assert.notDeepEqual(range('last-3-months','2026-03-15'),range('last-90-days','2026-03-15'));
 assert.deepEqual(range('last-6-months'),{from:'2026-05-01',to:'2026-10-29'});
 assert.deepEqual(range('last-12-months'),{from:'2025-11-01',to:'2026-10-29'});
 assert.deepEqual(range('last-3-months','2026-01-31'),{from:'2025-11-01',to:'2026-01-31'});
 assert.deepEqual(range('year'),{from:'2026-01-01',to:'2026-10-29'});
 assert.deepEqual(range('previous-year'),{from:'2025-01-01',to:'2025-12-31'});
 assert.deepEqual(range('previous-month','2026-01-01'),{from:'2025-12-01',to:'2025-12-31'});
 assert.match(defaultPeriodDescription('month'),/primeiro dia do mês/);
 assert.match(defaultPeriodDescription('last-30-days'),/30 dias corridos, incluindo hoje/);
});

test('leap months, short months and all rolling presets have inclusive valid ranges',()=>{
 assert.equal(defaultRange('previous-month','2024-03-31').to,'2024-02-29');
 assert.equal(defaultRange('previous-month','2025-03-31').to,'2025-02-28');
 assert.equal(defaultRange('last-6-months','2026-03-31').from,'2025-10-01');
 for(const today of ['2024-03-01','2026-01-01','2026-10-29','2018-11-05']){
  for(const item of DASHBOARD_ROLLING_PERIODS){const range=defaultRange(item.id,today);assert.equal(range.to,today);assert.equal(rangeDays(range),item.days);}
  for(const item of DASHBOARD_DEFAULT_PERIODS)assert.ok(validRange(defaultRange(item.id,today)),`${item.id}: ${today}`);
 }
 assert.deepEqual(defaultRange(undefined,'2026-10-29'),defaultRange('last-365-days','2026-10-29'));
});

test('saved periods validate known IDs and isolate authenticated accounts',()=>{
 for(const item of DASHBOARD_DEFAULT_PERIODS)assert.equal(readDefaultPeriod(item.id),item.id);
 for(const value of [null,undefined,'','monthly','__proto__','last-999-days'])assert.equal(readDefaultPeriod(value),'last-365-days');
 assert.notEqual(defaultPeriodKey('owner-a'),defaultPeriodKey('owner-b'));
 assert.equal(defaultPeriodKey(null),null);assert.equal(defaultPeriodKey(''),null);
 assert.match(defaultPeriodKey('owner:period'),/owner%3Aperiod$/);
});

const fixtureUrl=dataUrl(`
 export const state={slots:[],cursor:0,dirty:false};
 export function useState(initial){const i=state.cursor++;if(!(i in state.slots))state.slots[i]=typeof initial==='function'?initial():initial;return [state.slots[i],next=>{state.slots[i]=typeof next==='function'?next(state.slots[i]):next;state.dirty=true;}];}
 export const useMemo=factory=>factory(),useCallback=callback=>callback;
 export const useSyncExternalStore=(subscribe,snapshot)=>{subscribe(()=>{});return snapshot();};
 export const createContext=value=>({Provider:'provider',value}),useContext=context=>context.value;
 export const jsx=(type,props)=>({type,props});
`);
const {state}=await import(fixtureUrl);
const hookUrl=dataUrl(transpile('../modules/resumo/hooks/useDashboardFilters.ts').replace(/from ['"]react['"]/g,`from ${JSON.stringify(fixtureUrl)}`).replace(/from ['"]\.\.\/filters['"]/g,`from ${JSON.stringify(filtersUrl)}`));
const {useDashboardFilters}=await import(hookUrl);
test('opening and changing defaults applies dates while retaining selections and temporary date edits',()=>{
 state.slots=[];
 const render=period=>{let result;do{state.dirty=false;state.cursor=0;result=useDashboardFilters(period);}while(state.dirty);return result;};
 let model=render('last-365-days');assert.deepEqual(model.filters,defaultRange());
 model=render('month');assert.deepEqual(model.filters,defaultRange('month'));
 model.setFilters({...model.filters,from:'2025-01-01',to:'2025-02-01',partnerIds:['client-a'],status:'Ativo'});
 model=render('month');assert.equal(model.filters.from,'2025-01-01','Manual changes do not change the saved preference');
 model=render('last-6-months');assert.equal(model.filters.from,defaultRange('last-6-months').from);assert.deepEqual(model.filters.partnerIds,['client-a']);assert.equal(model.filters.status,'Ativo');assert.equal(model.draft.from,model.filters.from);
 model=render('month');assert.equal(model.filters.from,defaultRange('month').from,'Returning to a prior preset must recalculate it');
 state.slots=[];model=render('month');assert.deepEqual(model.filters,defaultRange('month'),'Reopening uses a fresh range');
});

const groupingUrl=dataUrl(transpile('../modules/resumo/financialGrouping.ts'));
const providerUrl=dataUrl(transpile('../modules/resumo/dashboardValues.tsx').replace(/from ['"]react(?:\/jsx-runtime)?['"]/g,`from ${JSON.stringify(fixtureUrl)}`).replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(sharedUrl)}`).replace(/from ['"]\.\/financialGrouping['"]/g,`from ${JSON.stringify(groupingUrl)}`).replace(/from ['"]\.\/defaultPeriod['"]/g,`from ${JSON.stringify(periodUrl)}`));
const {DashboardValuesProvider,dashboardNewsScopeKey}=await import(providerUrl);
test('browser preferences reload per account, synchronize across tabs and survive blocked storage in this session',()=>{
 const previousWindow=globalThis.window,values=new Map(),listeners=new Map();let blocked=false;
 globalThis.window={localStorage:{getItem(key){if(blocked)throw Error('blocked');return values.get(key)??null;},setItem(key,value){if(blocked)throw Error('blocked');values.set(key,value);}},addEventListener(name,handler){listeners.set(name,handler);},removeEventListener(){},dispatchEvent(){return true;}};
 const render=userId=>DashboardValuesProvider({userId,children:null}).props.value;
 try{
  let model=render('owner-a');assert.equal(model.defaultPeriod,'last-365-days');assert.equal(model.setDefaultPeriod('month'),true);
  assert.equal(model.newsScope,'all');assert.equal(model.setNewsScope('cane'),true);
  assert.equal(render('owner-a').newsScope,'cane');assert.equal(values.get(dashboardNewsScopeKey('owner-a')),'cane');assert.equal(render('owner-b').newsScope,'all');
  model=render('owner-a');assert.equal(model.defaultPeriod,'month');assert.equal(values.get(defaultPeriodKey('owner-a')),'month');
  assert.equal(render('owner-b').defaultPeriod,'last-365-days');
  blocked=true;model=render('owner-a');assert.equal(model.setDefaultPeriod('last-6-months'),false);assert.equal(render('owner-a').defaultPeriod,'last-6-months');assert.equal(render('owner-b').defaultPeriod,'last-365-days');
  assert.equal(model.setNewsScope('all'),false);assert.equal(render('owner-a').newsScope,'all');assert.equal(render('owner-b').newsScope,'all');
  blocked=false;model=render('owner-a');assert.equal(model.setDefaultPeriod('last-90-days'),true);assert.equal(render('owner-a').defaultPeriod,'last-90-days');
  values.set(defaultPeriodKey('owner-a'),'previous-month');listeners.get('storage')({key:defaultPeriodKey('owner-a')});assert.equal(render('owner-a').defaultPeriod,'previous-month');
  values.set(dashboardNewsScopeKey('owner-a'),'cane');listeners.get('storage')({key:dashboardNewsScopeKey('owner-a')});assert.equal(render('owner-a').newsScope,'cane');
  values.set(dashboardNewsScopeKey('owner-a'),'invalid');listeners.get('storage')({key:dashboardNewsScopeKey('owner-a')});assert.equal(render('owner-a').newsScope,'all');
  assert.equal(render(null).defaultPeriod,'last-365-days');assert.equal(render(null).setDefaultPeriod('month'),false);
  assert.equal(render(null).newsScope,'all');assert.equal(render(null).setNewsScope('cane'),false);
 }finally{globalThis.window=previousWindow;}
});
