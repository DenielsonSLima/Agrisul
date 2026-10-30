import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url),dataUrl=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const transpile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const react=pathToFileURL(require.resolve('react')).href,jsx=pathToFileURL(require.resolve('react/jsx-runtime')).href;
const shared=dataUrl(transpile('../shared/utils/presentation.ts'));
const period=dataUrl(transpile('../modules/resumo/defaultPeriod.ts'));
const filters=dataUrl(transpile('../modules/resumo/filters.ts').replaceAll("'@/shared/utils/presentation'",JSON.stringify(shared)).replaceAll("'./defaultPeriod'",JSON.stringify(period)));
const calendar=dataUrl(transpile('../modules/resumo/weekly.ts').replaceAll("'./filters'",JSON.stringify(filters)));
const {weeklyRange}=await import(calendar);
const values=dataUrl(`import {moneyLabel} from ${JSON.stringify(shared)};export const display={visible:true};export const useDashboardValues=()=>({visible:display.visible,money:value=>display.visible?moneyLabel(value):'••••••'});`);
const {display}=await import(values);
const fixtures=dataUrl(`import {createElement} from ${JSON.stringify(react)};
 export const CalendarDays=()=>null,Gauge=()=>null,Truck=()=>null,Wallet=()=>null;
 export const usePlotSize=()=>({ref:()=>{},size:{width:700,height:240}});
 export const DashboardAnalysis=({first,second})=>createElement('div',null,first,second);
 export const DashboardPanel=({title,children})=>createElement('section',null,createElement('h3',null,title),children);
 export const DashboardDataDialog=({children})=>createElement('div',null,children);`);
const component=dataUrl(transpile('../modules/resumo/components/DashboardWeekly.tsx')
 .replace(/from ['"]react['"]/g,`from ${JSON.stringify(react)}`).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsx)}`)
 .replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(shared)}`)
 .replace(/from ['"]\.\.\/dashboardValues['"]/g,`from ${JSON.stringify(values)}`)
 .replace(/from ['"]\.\.\/weekly['"]/g,`from ${JSON.stringify(calendar)}`)
 .replace(/from ['"](?:lucide-react|\.\.\/hooks\/usePlotSize|\.\/DashboardVisuals|\.\/DashboardDataDialog)['"]/g,`from ${JSON.stringify(fixtures)}`));
const {DashboardWeekly,WeeklyContext}=await import(component);
const totals={loadCount:3,loadedVolume:'123.456',averageAtr:'142.789',grossAmount:'17627.15',netAmount:'16001.13',billingPending:false,pendingLoadCount:0};
const data={range:{from:'2026-10-24',to:'2026-10-30'},totals,contractMethods:[{code:'1',label:'Manual',loadCount:1,loadedVolume:'30',averageAtr:'110'},{code:'2',label:'Mecanizada',loadCount:2,loadedVolume:'93.456',averageAtr:'150'},{code:'unknown',label:'Não classificado',loadCount:0,loadedVolume:'0',averageAtr:''}],comparison:{...totals,from:'2026-10-17',to:'2026-10-23',volumeChangePercent:'23.45',loadChangePercent:'-12.34',atrChange:'2.51',grossChangePercent:'35.64'},days:Array.from({length:7},(_,i)=>({...totals,date:`2026-10-${24+i}`}))};
test('rolling window uses Sao Paulo dates across midnight, month and year boundaries',()=>{
 assert.deepEqual(weeklyRange(new Date('2026-10-31T02:59:59Z')),{from:'2026-10-24',to:'2026-10-30'});
 assert.deepEqual(weeklyRange(new Date('2026-10-31T03:00:00Z')),{from:'2026-10-25',to:'2026-10-31'});
 assert.deepEqual(weeklyRange(new Date('2027-01-02T12:00:00Z')),{from:'2026-12-27',to:'2027-01-02'});
});
test('weekly renders six compact official KPIs with tonnes and ATR for each modality without duplicating filters',()=>{
 display.visible=true;const html=renderToStaticMarkup(createElement(DashboardWeekly,{data}));
 for(const label of ['Volume carregado','Carregamentos','ATR médio ponderado','Faturamento bruto','17.627,15','16.001,13','123,46','142,79','+2,51 kg/t','-12,34%'])assert.ok(html.includes(label),label);
 assert.equal((html.match(/data-weekly-days="7"/g)??[]).length,2);assert.match(html,/Hoje|hoje parcial/);
 assert.match(html,/data-metric-count="6"/);assert.match(html,/data-dashboard-metric="weekly-mechanized"/);assert.match(html,/data-dashboard-metric="weekly-manual"/);assert.match(html,/93,46/);assert.match(html,/150,00/);assert.match(html,/110,00/);
 const context=renderToStaticMarkup(createElement(WeeklyContext,{from:data.range.from,to:data.range.to}));
 assert.match(context,/24\/10 a 30\/10/);assert.doesNotMatch(context,/<button|<select|<input/);
});
test('mask hides money, financial deltas, tooltip and axis values while preserving volume and ATR',()=>{
 display.visible=false;const html=renderToStaticMarkup(createElement(DashboardWeekly,{data}));
 assert.doesNotMatch(html,/17\.627,15|16\.001,13|35,64|R\$ 17|17,6 mil|16 mil/);assert.match(html,/123,46/);assert.match(html,/142,79/);assert.match(html,/•••/);
});
test('productive pending days are retained without drawing false ATR points or adding idle dates',()=>{
 display.visible=true;const days=[{...data.days[2],loadCount:1,loadedVolume:'10',averageAtr:'',billingPending:true,pendingLoadCount:1,grossAmount:'',netAmount:''}];
 const html=renderToStaticMarkup(createElement(DashboardWeekly,{data:{...data,days,totals:{...totals,averageAtr:'',billingPending:true,grossAmount:'',netAmount:'',pendingLoadCount:1}}}));
 assert.match(html,/A apurar/);assert.equal((html.match(/data-weekly-days="1"/g)??[]).length,2);assert.doesNotMatch(html,/<circle|Sem cargas|<title>2026-10-26, hoje parcial/);
});
test('empty selection renders an explicit empty state and no invented dates or graph',()=>{
 display.visible=true;const empty={...totals,loadCount:0,loadedVolume:'0',averageAtr:'',grossAmount:'0',netAmount:'0'};
 const html=renderToStaticMarkup(createElement(DashboardWeekly,{data:{...data,totals:empty,days:[],contractMethods:data.contractMethods.map(row=>({...row,loadCount:0,loadedVolume:'0',averageAtr:''}))}}));
 assert.match(html,/Nenhum carregamento nos últimos 7 dias/);assert.doesNotMatch(html,/data-weekly-days=/);
});
