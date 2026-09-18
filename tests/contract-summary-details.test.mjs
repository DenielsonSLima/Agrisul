import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'contract-summary-details-'));
try{
 const output=join(directory,'summary.mjs');
 await build({stdin:{contents:`export {contractSummaryDetails} from './modules/contratos/utils/contractSummaryDetails'; export {createContractMonthlySummaryPdf} from './modules/contratos/reporting/contractMonthlySummaryPdf';`,resolveDir:process.cwd()},outfile:output,bundle:true,platform:'node',format:'esm'});
 const {contractSummaryDetails,createContractMonthlySummaryPdf}=await import(pathToFileURL(output));
 const metrics={loadedVolume:'250',averageAtr:'121.5',grossAmount:'150000.75',discountAmount:'2000.25',netAmount:'148000.50',advanceAmount:'25000.15',receiptAmount:'35000.35',refundedAmount:'0',receivedAmount:'60000.50',pendingAmount:'88000',creditAmount:'0',refundableAmount:'0',billingPending:false};
 const empty={...metrics,loadedVolume:'0',averageAtr:'',grossAmount:'0',discountAmount:'0',netAmount:'0',advanceAmount:'0',receiptAmount:'0',refundedAmount:'0',receivedAmount:'0',pendingAmount:'0',creditAmount:'0',refundableAmount:'0'};
 const advanceMonth={...empty,month:'2026-08',advanceAmount:'987.65',receivedAmount:'987.65',creditAmount:'987.65'};
 const production={month:'2026-09',atrReferenceMonth:'2026-08',loadedVolume:'250',averageLoadAtr:'121.5',atrQuote:'1.253367',billingAmount:'150000.75',billingPending:false,expenseAmount:'',expensesPending:true,resultAmount:''};
 const payment={id:'payment',requestId:'payment-request',kind:'advance',receivedAt:'2026-09-15',referenceMonth:'2026-08',amount:'987.65',document:'RECIBO-987',notes:'Entrada antecipada confirmada.',revision:1};
 const discount={id:'discount',requestId:'discount-request',title:'Acordo de transporte',ratePerTon:'8.001',months:['2026-09','2026-10'],notes:'Condições negociadas.',revision:1,loadedVolume:'250',amount:'2000.25'};
 const contract={id:'12345678-1234-4234-8234-123456789012',title:'Safra',contractNumber:'CTR-TESTE-2026',companyId:'company',companyName:'Empresa de teste',companyCnpj:'',clientId:'client',clientName:'Cliente do resumo completo',clientCnpj:'11222333000181',typeId:'type',typeName:'Fornecimento',stages:[],status:'Ativo',startDate:'2026-08-01',endDate:'2026-12-31',contractedVolume:'1000',loadedVolume:'250',remainingVolume:'750',averageAtr:'121.5',billingAmount:'150000.75',billingPending:false,atrPriceType:'gross',atrPeriodType:'accumulated',value:'',notes:'Orientações comerciais do contrato.',createdAt:'',updatedAt:'',monthlySummary:{criteria:{atrPriceType:'gross',atrPeriodType:'accumulated'},months:[production],totals:{contractedVolume:'1000',loadedVolume:'250',remainingVolume:'750',averageLoadAtr:'121.5',billingAmount:'150000.75',billingPending:false,pendingQuoteMonths:0,expenseAmount:'',expensesPending:true,resultAmount:''}},financialSummary:{months:[advanceMonth,{...metrics,month:'2026-09'},{...empty,month:'2026-10'}],totals:metrics,emptyMonth:empty,payments:[payment],refunds:[],discounts:[discount]}};
 const snapshot=JSON.stringify(contract),model=contractSummaryDetails(contract);
 assert.equal(JSON.stringify(contract),snapshot,'Presentation must not mutate RPC data');
 assert.equal(model.totals.finance,metrics,'Use RPC totals, not a sum of monthly balances');
 assert.deepEqual(model.months.map(item=>item.month),['2026-08','2026-09','2026-10']);
 assert.deepEqual(model.financialItems.map(item=>item.key),['gross','discount','net','advance','receipt','refund','received','pending','credit']);
 for(const [key,value] of [['advance','25.000,15'],['receipt','35.000,35'],['received','60.000,50'],['pending','88.000,00']])assert.ok(model.financialItems.find(item=>item.key===key).value.includes(value));
 assert.ok(model.operationalItems.find(item=>item.label==='Falta entregar').value.includes('750,00'));
 assert.ok(model.tables[1].rows[0][1].includes('987,65'));
 assert.equal(model.tables[2].rows[0][0],'15/09/2026');assert.equal(model.tables[2].rows[0][1],'Ago/2026');
 const agreement=model.tables.find(table=>table.title==='Acordos de desconto');
 assert.ok(agreement.rows[0][0].includes('Condições negociadas.'));
 assert.ok(agreement.rows[0][1].includes('8,001/t'),'Preserve the agreed rate precision');
 assert.equal(agreement.rows[0][2],'Set/2026, Out/2026');
 assert.ok(agreement.rows[0][3].includes('250,00'));
 assert.ok(agreement.rows[0][4].includes('2.000,25'),'Use the discount amount returned by the RPC');
 const pending={...metrics,billingPending:true,grossAmount:'',netAmount:'',pendingAmount:'',creditAmount:''};
 const pendingModel=contractSummaryDetails({...contract,financialSummary:{...contract.financialSummary,totals:pending}});
 for(const key of ['gross','net','pending','credit'])assert.equal(pendingModel.financialItems.find(item=>item.key===key).value,'Pendente');
 assert.ok(pendingModel.financialItems.find(item=>item.key==='received').value.includes('60.000,50'));
 const noFinance=contractSummaryDetails({...contract,financialSummary:undefined});
 assert.equal(noFinance.financialItems.find(item=>item.key==='received').value,'—');
 const brand={orientation:'portrait',header:{variant:'detailed',logoAlignment:'left',showCnpj:true,showContact:true},company:null,watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'user',name:'Responsável',email:'responsavel@example.test'},issuedAt:new Date('2026-09-15T12:00:00Z')};
 const longContract={...contract,notes:('Orientação comercial detalhada. '.repeat(120)+'FIM-DAS-OBSERVACOES'),financialSummary:{...contract.financialSummary,payments:Array.from({length:45},(_,index)=>({...payment,id:'payment-'+index,document:'RECIBO-'+String(index).padStart(3,'0'),notes:index===4?'Detalhes do comprovante. '.repeat(40)+'FIM-DO-COMPROVANTE':'Entrada confirmada.'})),discounts:[{...discount,notes:'Condições do acordo. '.repeat(45)+'FIM-DO-ACORDO'}]}};
 for(const orientation of ['portrait','landscape']){
  const {doc}=await createContractMonthlySummaryPdf(longContract,{...brand,orientation});
  const commands=doc.internal.pages.flat().join('\n');
  for(const text of ['Avanço do carregamento','Da entrega ao recebimento','Entregas, faturamento e entradas','Quantidade carregada por mês','Faturado e recebido por mês','Acordos de desconto','Valor por tonelada','Meses de aplicação','Base entregue','Desconto total','Adiantamentos','Recebimentos','Estornos','Total recebido','Crédito do contrato','Falta entregar','25.000,15','35.000,35','60.000,50','88.000,00','8,001/t','Ago/2026','Out/2026','RECIBO-044','FIM-DO-COMPROVANTE','FIM-DO-ACORDO','FIM-DAS-OBSERVACOES'])assert.ok(commands.includes(text),orientation+' lost '+text);
  assert.doesNotMatch(commands,/A ajustar|Dados essenciais|Condições do contrato/);
  assert.ok(doc.getNumberOfPages()>2);
  for(const page of doc.internal.pages.slice(1))for(const command of page){
   if(!command.includes(' Tj')||/Emitido por|Página/.test(command))continue;
   const position=command.match(/[-\d.]+ ([-\d.]+) Td/),leading=command.match(/([-\d.]+) TL/);
   if(position){const lastY=Number(position[1])-(command.match(/T\*/g)?.length??0)*Number(leading?.[1]??0);assert.ok(lastY>23*72/25.4,'Body text must stay above the footer in '+orientation);}
  }
  if(process.env.BILLING_SUMMARY_ARTIFACTS){const folder=resolve(process.env.BILLING_SUMMARY_ARTIFACTS);await mkdir(folder,{recursive:true});await writeFile(join(folder,'resumo-'+orientation+'.pdf'),new Uint8Array(doc.output('arraybuffer')));await writeFile(join(folder,'contract.json'),JSON.stringify(contract));}
 }
 console.log('Passed: nine financial indicators, delivery balance, payment-only months, credits, unavailable/pending states, RPC totals, full histories, long notes and PDF footer safety in both orientations.');
}finally{await rm(directory,{recursive:true,force:true});}
