import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'contract-daily-loads-'));
try{
 const output=join(directory,'presentation.mjs');
 await build({stdin:{contents:`export * from './modules/contratos/utils/contractDailyLoadsPresentation';`,resolveDir:process.cwd()},outfile:output,bundle:true,platform:'node',format:'esm'});
 const {defaultContractDailyLoadPeriod,contractDailyLoadGranularities,contractDailyLoadPeriodError,contractDailyLoadsChartPages,contractDailyLoadsChartRows,contractLoadFinancialChartRows}=await import(pathToFileURL(output));
 assert.deepEqual(contractDailyLoadGranularities,['day','week','fortnight','month']);
 assert.deepEqual(defaultContractDailyLoadPeriod(new Date(2026,8,28,18,30)),{from:'2026-09-14',to:'2026-09-28',granularity:'day'},'The default range must include today and the previous fourteen days');
 assert.deepEqual(defaultContractDailyLoadPeriod(new Date(2026,0,5,18,30)),{from:'2025-12-22',to:'2026-01-05',granularity:'day'},'The fifteen-day default must cross month and year boundaries safely');
 assert.equal(contractDailyLoadPeriodError({from:'2026-09-20',to:'2026-09-19'}),'A data inicial deve ser igual ou anterior à data final.');
 const data={summary:{activeDayCount:3,averageDailyVolume:'9.5',monthCount:1},monthlyVolumes:[{month:'2026-09',volume:'28.5',loadCount:4}],groups:[
  {key:'2026-09-20',label:'2026-09-20',loadCount:1,volume:'6.25',averageAtr:'122.5',loads:[]},
  {key:'2026-09-22',label:'2026-09-22',loadCount:1,volume:'12.5',averageAtr:'130',loads:[]},
  {key:'2026-09-18',label:'2026-09-18',loadCount:2,volume:'9.75',averageAtr:'119.3959',loads:[]},
 ]};
 const rows=contractDailyLoadsChartRows(data);
 assert.deepEqual(rows.map(row=>[row.date,row.volume,row.loadCount]),[['2026-09-18',9.75,2],['2026-09-20',6.25,1],['2026-09-22',12.5,1]]);
 assert.deepEqual(rows.map(row=>[row.key,row.endDate,row.label]),[['2026-09-18','2026-09-18','18/09'],['2026-09-20','2026-09-20','20/09'],['2026-09-22','2026-09-22','22/09']]);
 assert.deepEqual(rows.map(row=>row.averageAtr),[119.3959,122.5,130],'The line uses each server-calculated daily ATR average in chronological order');
 const weeks=contractDailyLoadsChartRows(data,'week');
 assert.deepEqual(weeks.map(row=>[row.date,row.endDate,row.label,row.volume,row.loadCount]),[['2026-09-14','2026-09-20','14–20/09',16,3],['2026-09-21','2026-09-27','21–27/09',12.5,1]]);
 assert.ok(Math.abs(weeks[0].averageAtr-((9.75*119.3959+6.25*122.5)/16))<1e-9,'Weekly ATR must be weighted by loaded volume');
 const fortnights=contractDailyLoadsChartRows(data,'fortnight');
 assert.deepEqual(fortnights.map(row=>[row.date,row.endDate,row.label,row.volume,row.loadCount]),[['2026-09-16','2026-09-30','2ª quinz. Set/2026',28.5,4]]);
 assert.equal(fortnights[0].averageAtrText,String(Number(((9.75*119.3959+6.25*122.5+12.5*130)/28.5).toFixed(6))));
 const months=contractDailyLoadsChartRows(data,'month');
 assert.deepEqual(months.map(row=>[row.date,row.endDate,row.label,row.volume,row.loadCount]),[['2026-09-01','2026-09-30','Set/2026',28.5,4]]);
 assert.deepEqual(contractDailyLoadsChartRows({...data,groups:[{...data.groups[0],averageAtr:''}]}).map(row=>row.averageAtr),[null],'Missing ATR stays absent instead of becoming zero');
 const financialData={...data,groups:[
  {...data.groups[0],loads:[{loadedAt:'2026-09-20',volume:'6.25',atr:'122.5',grossAmount:'1000.25',netAmount:'800.2',billingPending:false}]},
  {...data.groups[1],loads:[{loadedAt:'2026-09-22',volume:'12.5',atr:'130',grossAmount:'2000.75',netAmount:'1600.3',billingPending:false}]},
  {...data.groups[2],loads:[{loadedAt:'2026-09-18',volume:'4.75',atr:'118',grossAmount:'750',netAmount:'600',billingPending:false},{loadedAt:'2026-09-18',volume:'5',atr:'120.722105',grossAmount:'',netAmount:'',billingPending:true}]},
 ]};
 const dailyFinancial=contractLoadFinancialChartRows(financialData,'day');
 assert.deepEqual(dailyFinancial.map(row=>[row.date,row.gross,row.net,row.billingPending]),[['2026-09-18',null,null,true],['2026-09-20',1000.25,800.2,false],['2026-09-22',2000.75,1600.3,false]],'Pending prices stay unavailable only in their own bucket');
 const weeklyFinancial=contractLoadFinancialChartRows(financialData,'week');
 assert.deepEqual(weeklyFinancial.map(row=>[row.date,row.gross,row.net,row.billingPending]),[['2026-09-14',null,null,true],['2026-09-21',2000.75,1600.3,false]],'Financial values follow the same week buckets as the upper chart');
 assert.ok(Math.abs(weeklyFinancial[0].averageAtr-((4.75*118+5*120.722105+6.25*122.5)/16))<1e-9,'Financial chart ATR must be weighted from the individual loads');
 const monthlyFinancial=contractLoadFinancialChartRows(financialData,'month');
 assert.deepEqual(monthlyFinancial.map(row=>[row.label,row.volume,row.loadCount]),[['Set/2026',28.5,4]],'Daily loads roll up into the selected monthly visualization');
 const sixteenDays=Array.from({length:16},(_,index)=>`day-${index+1}`),pdfPages=contractDailyLoadsChartPages(sixteenDays);
 assert.deepEqual(pdfPages,[sixteenDays.slice(0,8),sixteenDays.slice(7,15),sixteenDays.slice(14,16)],'Every PDF page after the first must repeat the previous final bar so the ATR line remains continuous');
 assert.deepEqual(contractDailyLoadsChartPages(sixteenDays.slice(0,8)),[sixteenDays.slice(0,8)],'A full final page must not create an extra overlap-only page');
 assert.throws(()=>contractDailyLoadsChartPages(sixteenDays,1),RangeError,'Reject an overlap step of zero instead of risking an infinite loop');
 assert.equal(data.groups[0].volume,'6.25','Presentation must not mutate values returned by the RPC');
 const component=await readFile('modules/contratos/components/details/ContractDailyLoadsChart.tsx','utf8');
 const chartCss=await readFile('modules/contratos/components/details/contract-daily-loads-chart.css','utf8');
 assert.match(component,/onClick=\{resetPeriod\}[\s\S]*Últimos 15 dias/,'The quick action must restore the shared fifteen-day range');
 assert.match(component,/defaultContractDailyLoadPeriod\(\),granularity/,'The quick action must preserve the selected visualization granularity');
 assert.match(component,/data=\{rows\}/);assert.match(component,/dataKey="averageAtr"/);assert.match(component,/yAxisId="atr"/);assert.match(component,/strokeDasharray="6 5"/);assert.match(component,/strokeOpacity=\{\.52\}/);
 assert.match(component,/contractDailyLoadGranularities\.map/);assert.match(component,/aria-pressed=\{granularity===value\}/);assert.match(component,/<PeriodAxisTick rows=\{rows\}\/>/);
 assert.doesNotMatch(component,/contract-daily-loads-axis-atr/,'The x-axis must contain only the period label');
 assert.match(component,/<LabelList dataKey="averageAtr" position="top" offset=\{10\} dx=\{8\} textAnchor="start" formatter=\{atrPointLabel\} className="contract-daily-loads-line-atr" aria-hidden="true"\/>/,'Each ATR must be placed above and to the right of its line marker');
 assert.match(component,/padding=\{\{left:8,right:72\}\}/,'The final ATR label needs reserved horizontal space');
 assert.match(chartCss,/\.contract-daily-loads-line-atr\{[^}]*paint-order:stroke[^}]*pointer-events:none/,'Line labels must remain legible without intercepting pointer interaction');
 assert.doesNotMatch(component,/linePercent|variationLabel|VariationDot|Variação percentual/,'The screen chart must not retain percentage-transition semantics');
 assert.match(component,/copy\.atr/);assert.match(component,/ATR médio do período/);
 assert.doesNotMatch(component,/Volume total por mês/,'The redundant monthly volume cards must stay removed');
 console.log('Passed: fifteen-day window, daily/weekly/fortnightly/monthly aggregation, weighted ATR line, point-adjacent ATR labels and period KPI.');
}finally{await rm(directory,{recursive:true,force:true});}
