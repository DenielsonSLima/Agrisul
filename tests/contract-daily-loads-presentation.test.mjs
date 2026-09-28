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
 const {defaultContractDailyLoadPeriod,contractDailyLoadPeriodError,contractDailyLoadsChartPages,contractDailyLoadsChartRows}=await import(pathToFileURL(output));
 assert.deepEqual(defaultContractDailyLoadPeriod(new Date(2026,8,28,18,30)),{from:'2026-03-28',to:'2026-09-28'});
 assert.deepEqual(defaultContractDailyLoadPeriod(new Date(2026,7,31,18,30)),{from:'2026-02-28',to:'2026-08-31'},'Clamp the start day when the target month is shorter');
 assert.equal(contractDailyLoadPeriodError({from:'2026-09-20',to:'2026-09-19'}),'A data inicial deve ser igual ou anterior à data final.');
 const data={summary:{activeDayCount:3,averageDailyVolume:'9.5',monthCount:1},monthlyVolumes:[{month:'2026-09',volume:'28.5',loadCount:4}],groups:[
  {key:'2026-09-20',label:'2026-09-20',loadCount:1,volume:'6.25',averageAtr:'122.5',loads:[]},
  {key:'2026-09-22',label:'2026-09-22',loadCount:1,volume:'12.5',averageAtr:'130',loads:[]},
  {key:'2026-09-18',label:'2026-09-18',loadCount:2,volume:'9.75',averageAtr:'119.3959',loads:[]},
 ]};
 const rows=contractDailyLoadsChartRows(data);
 assert.deepEqual(rows.map(row=>[row.date,row.volume,row.loadCount]),[['2026-09-18',9.75,2],['2026-09-20',6.25,1],['2026-09-22',12.5,1]]);
 assert.deepEqual(rows.map(row=>row.averageAtr),[119.3959,122.5,130],'The line uses each server-calculated daily ATR average in chronological order');
 assert.deepEqual(contractDailyLoadsChartRows({...data,groups:[{...data.groups[0],averageAtr:''}]}).map(row=>row.averageAtr),[null],'Missing ATR stays absent instead of becoming zero');
 const sixteenDays=Array.from({length:16},(_,index)=>`day-${index+1}`),pdfPages=contractDailyLoadsChartPages(sixteenDays);
 assert.deepEqual(pdfPages,[sixteenDays.slice(0,8),sixteenDays.slice(7,15),sixteenDays.slice(14,16)],'Every PDF page after the first must repeat the previous final bar so the ATR line remains continuous');
 assert.deepEqual(contractDailyLoadsChartPages(sixteenDays.slice(0,8)),[sixteenDays.slice(0,8)],'A full final page must not create an extra overlap-only page');
 assert.throws(()=>contractDailyLoadsChartPages(sixteenDays,1),RangeError,'Reject an overlap step of zero instead of risking an infinite loop');
 assert.equal(data.groups[0].volume,'6.25','Presentation must not mutate values returned by the RPC');
 const component=await readFile('modules/contratos/components/details/ContractDailyLoadsChart.tsx','utf8');
 assert.match(component,/data=\{rows\}/);assert.match(component,/dataKey="averageAtr"/);assert.match(component,/yAxisId="atr"/);assert.match(component,/strokeDasharray="6 5"/);assert.match(component,/strokeOpacity=\{\.52\}/);
 assert.doesNotMatch(component,/linePercent|variationLabel|VariationDot|Variação percentual/,'The screen chart must not retain percentage-transition semantics');
 assert.match(component,/ATR médio do dia/);assert.match(component,/ATR médio do período/);
 assert.doesNotMatch(component,/Volume total por mês/,'The redundant monthly volume cards must stay removed');
 console.log('Passed: six-month window, chronological bars, daily ATR line, missing ATR handling and period KPI.');
}finally{await rm(directory,{recursive:true,force:true});}
