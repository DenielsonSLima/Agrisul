import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../modules/resumo/utils/financialChart.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {financialChartRows,financialChartCapacity,financialChartPage,grossChangeLabel}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const groupingSource=ts.transpileModule(readFileSync(new URL('../modules/resumo/financialGrouping.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {readFinancialGrouping,financialGroupingKey}=await import('data:text/javascript;base64,'+Buffer.from(groupingSource).toString('base64'));
test('daily finance uses official exact values and hides only periods without activity',()=>{
 const monthly=[{month:'2026-09',loadCount:1,grossAmount:'10',netAmount:'9',receivedAmount:'0',billingPending:false}],daily=[{date:'2026-09-15',loadCount:1,grossAmount:'123456789012345.123456',netAmount:'100000000000000.000001',receivedAmount:'0',billingPending:false},{date:'2026-09-16',loadCount:0,grossAmount:'0',netAmount:'0',receivedAmount:'0',billingPending:false},{date:'2026-09-17',loadCount:0,grossAmount:'0',netAmount:'0',receivedAmount:'10.1256',billingPending:false},{date:'2026-09-18',loadCount:1,grossAmount:'',netAmount:'',receivedAmount:'0',billingPending:true}];
 const before=structuredClone(daily),rows=financialChartRows(monthly,daily);assert.deepEqual(rows.map(row=>row.key),['2026-09-15','2026-09-17','2026-09-18']);assert.equal(rows[0].grossAmount,'123456789012345.123456');assert.equal(rows[2].billingPending,true);assert.deepEqual(daily,before);assert.deepEqual(financialChartRows(monthly,[]),[]);assert.equal(financialChartRows(monthly)[0].granularity,'month');
});
test('finance pagination adapts to plot width and exact-label length without dropping periods',()=>{
 const narrow=financialChartCapacity(320,15),wide=financialChartCapacity(1440,15),long=financialChartCapacity(1440,28);assert.equal(narrow,1);assert.ok(wide>narrow);assert.ok(long<wide);
 const rows=Array.from({length:13},(_,index)=>index+1),pages=Math.ceil(rows.length/wide),shown=Array.from({length:pages},(_,page)=>financialChartPage(rows,wide,page));assert.equal(shown[0].at(-1),13);assert.deepEqual(shown.flat().sort((a,b)=>a-b),rows);assert.deepEqual(rows,Array.from({length:13},(_,index)=>index+1));
});
test('financial grouping defaults to month and uses only the selected official projection',()=>{
 for(const input of [null,undefined,'','invalid'])assert.equal(readFinancialGrouping(input),'month');for(const input of ['day','week','fortnight','month'])assert.equal(readFinancialGrouping(input),input);
 assert.notEqual(financialGroupingKey('owner-a'),financialGroupingKey('owner-b'));
 const month=[{month:'2026-09',loadCount:1,billingPending:false,grossAmount:'100',netAmount:'90',receivedAmount:'0'}],day=[{date:'2026-09-15',loadCount:1,billingPending:false,grossAmount:'50',netAmount:'45',receivedAmount:'0'}],period=[{...day[0],date:'2026-09-14',endDate:'2026-09-20',grossAmount:'100',netAmount:'90'}];
 assert.equal(financialChartRows(month,day,'month')[0].key,'2026-09');assert.equal(financialChartRows(month,day,'day')[0].grossAmount,'50');assert.equal(financialChartRows(month,day,'week',period)[0].endDate,'2026-09-20');assert.equal(financialChartRows(month,day,'fortnight',period)[0].granularity,'fortnight');assert.deepEqual(financialChartRows(month,day,'week'),[]);
});

test('gross variation labels format server percentages and identify unavailable comparisons',()=>{
 assert.equal(grossChangeLabel({grossChangePercent:'-93.51',grossChangeReason:''}),'-93,51%');
 assert.equal(grossChangeLabel({grossChangePercent:'25',grossChangeReason:''}),'+25,00%');
 assert.equal(grossChangeLabel({grossChangePercent:'0',grossChangeReason:''}),'0,00%');
 assert.equal(grossChangeLabel({grossChangePercent:'',grossChangeReason:'zero-base'}),'Sem base');
 assert.equal(grossChangeLabel({grossChangePercent:'',grossChangeReason:'pending'}),'A apurar');
 assert.equal(grossChangeLabel({grossChangePercent:'',grossChangeReason:'initial'}),'—');
 assert.equal(grossChangeLabel({}),'A apurar');
});
