import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));

test('monthly delivery rows preserve RPC totals and attach priced loads to their own month',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'contract-monthly-deliveries-'));
 try{
  const output=join(directory,'model.mjs');
  await build({entryPoints:['modules/contratos/utils/contractMonthlyDeliveries.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
  const {contractMonthlyDeliveryRows}=await import(pathToFileURL(output));
  const production={month:'2026-09',atrReferenceMonth:'2026-09',loadedVolume:'30',averageLoadAtr:'121.5',atrQuote:'1.25',billingAmount:'4537.50',billingPending:false};
  const finance={month:'2026-09',loadedVolume:'30',averageAtr:'121.5',grossAmount:'4537.50',discountAmount:'100',netAmount:'4437.50',billingPending:false};
  const load={id:'load-1',contractId:'contract',farmId:'farm',plotId:'plot',farmName:'Fazenda A',plotName:'Talhão 1',loadedAt:'2026-09-15',volume:'30',atr:'121.5',atrReferenceMonth:'2026-09',atrQuote:'1.25',grossAmount:'4537.50',discountAmount:'100',netAmount:'4437.50',billingPending:false,document:'TKT-1',notes:'',createdAt:'',updatedAt:''};
  const contract={monthlySummary:{months:[production]},financialSummary:{months:[finance]}};
  const data={groups:[{key:'2026-09',loads:[load]},{key:'2026-10',loads:[]}]};
  const rows=contractMonthlyDeliveryRows(contract,data);
  assert.deepEqual(rows.map(row=>row.month),['2026-09','2026-10']);
  assert.equal(rows[0].grossAmount,'4537.50');assert.equal(rows[0].discountAmount,'100');assert.equal(rows[0].netAmount,'4437.50');
  assert.equal(rows[0].atrReferenceMonth,'2026-09','the current/fallback reference is presented exactly as returned by the RPC');
  assert.equal(rows[0].loads[0],load,'priced loads are not reconstructed in the browser');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('expandable monthly table has native button semantics and responsive load details',async()=>{
 const [source,css]=await Promise.all([
  readFile(new URL('../modules/contratos/components/details/ContractMonthlyDeliveriesTable.tsx',import.meta.url),'utf8'),
  readFile(new URL('../modules/contratos/components/details/ContractMonthlyDeliveriesTable.module.css',import.meta.url),'utf8'),
 ]);
 assert.match(source,/type="button"[^>]*className=\{styles\.toggle\}[^>]*aria-expanded=\{expanded\}[^>]*aria-controls=\{detailId\}/);
 assert.match(source,/new Set\(current\)/,'each month must keep independent expansion state');
 assert.match(source,/role="region" aria-label=\{`Carregamentos de \$\{monthLabel\}`\}/);
 assert.match(source,/<th scope="row">/);assert.match(source,/<th scope="col">Data<\/th>/);
 for(const field of ['load.loadedAt','load.volume','load.atr','load.atrQuote','load.atrReferenceMonth','load.grossAmount','load.discountAmount','load.netAmount','load.document','load.notes'])assert.match(source,new RegExp(field.replace('.','\\.')));
 assert.match(css,/@media\(max-width:650px\)/);assert.match(css,/content:attr\(data-label\)/);
});

test('monthly balance rows preserve RPC snapshots and group entries by reference month',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'contract-monthly-balances-'));
 try{
  const output=join(directory,'model.mjs');
  await build({entryPoints:['modules/contratos/utils/contractMonthlyBalances.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
  const {contractMonthlyBalanceRows}=await import(pathToFileURL(output));
  const finance={month:'2026-09',advanceAmount:'1000',receiptAmount:'500',refundedAmount:'100',receivedAmount:'1400',pendingAmount:'3100',creditAmount:'0',loadedVolume:'30',averageAtr:'121.5',grossAmount:'4537.50',discountAmount:'37.50',netAmount:'4500',refundableAmount:'0',billingPending:false};
  const payment={id:'pay-1',revision:1,requestId:'request-1',kind:'advance',receivedAt:'2026-09-20',referenceMonth:'2026-09',amount:'1000',document:'PIX-1',notes:'Entrada'};
  const refund={id:'refund-1',revision:1,requestId:'request-2',refundedAt:'2026-09-25',referenceMonth:'2026-09',amount:'100',document:'EST-1',notes:'Devolução'};
  const contract={monthlySummary:{months:[{month:'2026-09'}]},financialSummary:{months:[finance],payments:[payment],refunds:[refund],discounts:[]}};
  const rows=contractMonthlyBalanceRows(contract);
  assert.equal(rows[0].finance,finance,'monthly balances must remain the RPC snapshot');
  assert.deepEqual(rows[0].entries.map(entry=>[entry.type,entry.amount]),[['Estorno','100'],['Adiantamento','1000']]);
  assert.equal(rows[0].entries[0].document,'EST-1');assert.equal(rows[0].entries[1].notes,'Entrada');
  assert.deepEqual(contractMonthlyBalanceRows(contract,{from:'2026-10',to:'2026-12'}),[],'period filters the presentation only');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('expandable monthly balances use native controls and responsive entry details',async()=>{
 const [source,css,overview]=await Promise.all([
  readFile(new URL('../modules/contratos/components/details/ContractMonthlyBalancesTable.tsx',import.meta.url),'utf8'),
  readFile(new URL('../modules/contratos/components/details/ContractMonthlyBalancesTable.module.css',import.meta.url),'utf8'),
  readFile(new URL('../modules/contratos/components/details/ContractSummaryFinancialOverview.tsx',import.meta.url),'utf8'),
 ]);
 assert.match(source,/type="button"[^>]*className=\{styles\.toggle\}[^>]*aria-expanded=\{expanded\}[^>]*aria-controls=\{detailId\}/);
 assert.match(source,/new Set\(current\)/,'each month must keep independent expansion state');
 assert.match(source,/role="region" aria-label=\{`Lançamentos de \$\{monthLabel\}`\}/);
 assert.match(source,/<th scope="row">/);assert.match(source,/<th scope="col">Data<\/th>/);
 for(const field of ['entry.date','entry.type','entry.amount','entry.document','entry.notes'])assert.match(source,new RegExp(field.replace('.','\\.')));
 assert.match(css,/@media\(max-width:650px\)/);assert.match(css,/content:attr\(data-label\)/);
 assert.match(overview,/<ContractMonthlyBalancesTable contract=\{contract\} period=\{monthlyPeriod\}\/>/);
});
