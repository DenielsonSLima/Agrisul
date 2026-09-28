import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]})),directory=await mkdtemp(join(tmpdir(),'contract-monthly-period-'));
try{
 const output=join(directory,'period.mjs');
 await build({entryPoints:['modules/contratos/utils/contractMonthlyPeriod.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
 const {defaultContractMonthlyPeriod,contractMonthlyPeriodFromDateRange,contractMonthlyDateFilters,contractMonthlyPeriodError,filterContractMonths}=await import(pathToFileURL(output));
 assert.deepEqual(defaultContractMonthlyPeriod(new Date(2026,8,28)),{from:'2026-04',to:'2026-09'},'Current month plus the five previous months');
 assert.deepEqual(defaultContractMonthlyPeriod(new Date(2026,0,15)),{from:'2025-08',to:'2026-01'},'Six-month default crosses years');
 assert.deepEqual(contractMonthlyDateFilters({from:'2026-02',to:'2026-02'}),{from:'2026-02-01',to:'2026-02-28'});
 assert.deepEqual(contractMonthlyPeriodFromDateRange({from:'2026-03-28',to:'2026-09-28'}),{from:'2026-03',to:'2026-09'},'Daily dates synchronize the monthly buckets without changing their boundaries');
 assert.equal(contractMonthlyPeriodError({from:'2026-09',to:'2026-08'}),'O mês inicial deve ser igual ou anterior ao mês final.');
 assert.deepEqual(filterContractMonths([{month:'2026-07'},{month:'2026-08'},{month:'2026-09'}],{from:'2026-08',to:'2026-09'}),[{month:'2026-08'},{month:'2026-09'}]);
 console.log('Passed: monthly period defaults, validation, date boundaries and filtering.');
}finally{await rm(directory,{recursive:true,force:true});}
