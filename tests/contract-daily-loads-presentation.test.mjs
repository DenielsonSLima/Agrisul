import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'contract-daily-loads-'));
try{
 const output=join(directory,'presentation.mjs');
 await build({stdin:{contents:`export * from './modules/contratos/utils/contractDailyLoadsPresentation';`,resolveDir:process.cwd()},outfile:output,bundle:true,platform:'node',format:'esm'});
 const {defaultContractDailyLoadPeriod,contractDailyLoadPeriodError,contractDailyLoadsChartRows}=await import(pathToFileURL(output));
 assert.deepEqual(defaultContractDailyLoadPeriod(new Date(2026,8,28,18,30)),{from:'2026-03-28',to:'2026-09-28'});
 assert.deepEqual(defaultContractDailyLoadPeriod(new Date(2026,7,31,18,30)),{from:'2026-02-28',to:'2026-08-31'},'Clamp the start day when the target month is shorter');
 assert.equal(contractDailyLoadPeriodError({from:'2026-09-20',to:'2026-09-19'}),'A data inicial deve ser igual ou anterior à data final.');
 const data={summary:{activeDayCount:2,averageDailyVolume:'8',monthCount:1},monthlyVolumes:[{month:'2026-09',volume:'16',loadCount:3}],groups:[
  {key:'2026-09-20',label:'2026-09-20',loadCount:1,volume:'6.25',averageAtr:'',loads:[]},
  {key:'2026-09-18',label:'2026-09-18',loadCount:2,volume:'9.75',averageAtr:'',loads:[]},
 ]};
 const rows=contractDailyLoadsChartRows(data);
 assert.deepEqual(rows.map(row=>[row.date,row.volume,row.loadCount]),[['2026-09-18',9.75,2],['2026-09-20',6.25,1]]);
 assert.equal(rows[0].variationPercent,null,'The first bar has no previous loading to compare');
 assert.ok(Math.abs(rows[1].variationPercent-(-35.8974358974359))<1e-10,'Variation compares each daily loading volume with the previous bar');
 assert.equal(data.groups[0].volume,'6.25','Presentation must not mutate values returned by the RPC');
 console.log('Passed: default six-month window, period validation, chronological bars and percentage variation.');
}finally{await rm(directory,{recursive:true,force:true});}
