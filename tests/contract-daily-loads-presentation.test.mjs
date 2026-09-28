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
 const {defaultContractDailyLoadPeriod,contractDailyLoadPeriodError,contractDailyLoadsChartPages,contractDailyLoadsChartRows,contractDailyLoadsChartSlots}=await import(pathToFileURL(output));
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
 assert.equal(rows[0].variationPercent,null,'The first bar has no previous loading to compare');
 assert.ok(Math.abs(rows[1].variationPercent-(-35.8974358974359))<1e-10,'Variation compares each daily loading volume with the previous bar');
 assert.equal(rows[2].variationPercent,100);
 const slots=contractDailyLoadsChartSlots(data);
 assert.deepEqual(slots.map(slot=>slot.kind),['day','variation','day','variation','day'],'A transition slot must sit strictly between each pair of daily bars');
 assert.deepEqual(slots.map(slot=>slot.slotKey),[
  'day:2026-09-18','variation:2026-09-18:2026-09-20','day:2026-09-20','variation:2026-09-20:2026-09-22','day:2026-09-22',
 ]);
 assert.equal(slots[0].linePercent,0,'The line starts at zero on the first loading, which is its visual base');
 assert.equal(slots[0].isVariationBase,true);
 assert.equal(slots[0].averageAtrText,'119.3959','Each daily slot keeps the server-calculated ATR average for its tooltip');
 assert.equal(slots[1].fromDate,'2026-09-18');assert.equal(slots[1].toDate,'2026-09-20');
 assert.equal(slots[1].baseVolume,9.75);assert.equal(slots[1].currentVolume,6.25);
 assert.ok(Math.abs(slots[1].linePercent-(-35.8974358974359))<1e-10,'The interval marker uses the first loading as the denominator');
 assert.equal(slots[2].linePercent,null,'Daily bars after the base must not receive a percentage marker');
 assert.equal(slots[3].linePercent,100,'Each following interval uses its immediately preceding loading as the base');
 const single=contractDailyLoadsChartSlots({...data,groups:[data.groups[2]]});
 assert.equal(single.length,1);assert.equal(single[0].kind,'day');assert.equal(single[0].linePercent,0);
 const sixteenDays=Array.from({length:16},(_,index)=>`day-${index+1}`),pdfPages=contractDailyLoadsChartPages(sixteenDays);
 assert.deepEqual(pdfPages,[sixteenDays.slice(0,8),sixteenDays.slice(7,15),sixteenDays.slice(14,16)],'Every PDF page after the first must repeat the previous final bar so no interval is lost');
 assert.deepEqual(contractDailyLoadsChartPages(sixteenDays.slice(0,8)),[sixteenDays.slice(0,8)],'A full final page must not create an extra overlap-only page');
 assert.throws(()=>contractDailyLoadsChartPages(sixteenDays,1),RangeError,'Reject an overlap step of zero instead of risking an infinite loop');
 assert.equal(data.groups[0].volume,'6.25','Presentation must not mutate values returned by the RPC');
 const component=await readFile('modules/contratos/components/details/ContractDailyLoadsChart.tsx','utf8');
 assert.match(component,/data=\{slots\}/);assert.match(component,/dataKey="linePercent"/);assert.match(component,/connectNulls/);assert.match(component,/dataKey="variationLabel"/);
 assert.match(component,/payload\?\.kind!==['"]variation['"]/,'Only transition slots render percentage dots');
 assert.match(component,/ATR médio do dia/);assert.match(component,/ATR médio do período/);
 assert.doesNotMatch(component,/Volume total por mês/,'The redundant monthly volume cards must stay removed');
 console.log('Passed: six-month window, chronological bars, interval percentage slots, zero baseline and midpoint markers.');
}finally{await rm(directory,{recursive:true,force:true});}
