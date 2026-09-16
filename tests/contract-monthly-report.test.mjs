import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]})),directory=await mkdtemp(join(tmpdir(),'contract-monthly-report-'));
try{
 const output=join(directory,'report.mjs');
 await build({entryPoints:['modules/contratos/reporting/contractMonthlySummaryPdf.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
 const {createContractMonthlySummaryPdf}=await import(pathToFileURL(output));
 const presentationOutput=join(directory,'presentation.mjs');
 await build({entryPoints:['modules/contratos/utils/contractMonthlyPresentation.ts'],outfile:presentationOutput,bundle:true,platform:'node',format:'esm'});
 const {contractMonthlyPresentation,contractMonthlyFinanceItems}=await import(pathToFileURL(presentationOutput));
 const months=Array.from({length:14},(_,index)=>{const date=new Date(Date.UTC(2025,index,1)),reference=new Date(Date.UTC(2025,index-1,1));return {month:date.toISOString().slice(0,7),atrReferenceMonth:reference.toISOString().slice(0,7),loadedVolume:String(100+index),averageLoadAtr:'121.5',atrQuote:'1.253367',billingAmount:String(15000+index*100),billingPending:false,expenseAmount:'',expensesPending:true,resultAmount:''};});
 const contract={id:'12345678-1234-4234-8234-123456789012',title:'Contrato safra',contractNumber:'CTR-123/2026',companyId:'company',companyName:'Empresa A',companyCnpj:'',clientId:'client',clientName:'Cliente mensal',clientCnpj:'11222333000181',typeId:'type',typeName:'Fornecimento',stages:[],status:'Ativo',startDate:'2025-01-01',endDate:'',contractedVolume:'2000',atrPriceType:'gross',atrPeriodType:'monthly',loadedVolume:'1491',remainingVolume:'509',averageAtr:'121.5',billingAmount:'219100',billingPending:false,value:'',notes:'',loads:[],createdAt:'',updatedAt:'',monthlySummary:{criteria:{atrPriceType:'gross',atrPeriodType:'monthly'},months,totals:{contractedVolume:'2000',loadedVolume:'1491',remainingVolume:'509',averageLoadAtr:'121.5',billingAmount:'219100',billingPending:false,pendingQuoteMonths:0,expenseAmount:'',expensesPending:true,resultAmount:''}}};
 const brand={orientation:'portrait',header:{variant:'compact',logoAlignment:'left',showCnpj:true,showContact:true},company:null,watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'user',name:'Responsável',email:'responsavel@example.test'},issuedAt:new Date('2026-09-15T12:00:00Z')};
 const metrics={loadedVolume:'40',averageAtr:'134',grossAmount:'6431.46',discountAmount:'3000',netAmount:'3431.46',advanceAmount:'1000',receiptAmount:'200',receivedAmount:'1200',pendingAmount:'2231.46',creditAmount:'0',billingPending:false};
 const paidMonth={...metrics,month:'2024-12',loadedVolume:'0',averageAtr:'',grossAmount:'0',discountAmount:'0',netAmount:'0',advanceAmount:'75.25',receiptAmount:'0',receivedAmount:'75.25',pendingAmount:'0',creditAmount:'75.25'};
 contract.financialSummary={months:[...months.map(month=>({...metrics,month:month.month})),paidMonth,{...paidMonth,month:'2027-01'}],totals:{...metrics,discountAmount:'42000',netAmount:'179100',receivedAmount:'16875.25',pendingAmount:'162224.75'},payments:[{referenceMonth:'2024-12',receivedAt:'2026-09-15'}],discounts:[]};
 const view=contractMonthlyPresentation(contract);
 assert.equal(view.months.length,15,'Payment-only reference months must be included, without empty future months');
 assert.equal(view.months[0].month,'2024-12','Use payment reference month, not receipt date or array index');
 assert.equal(view.months[0].finance.receivedAmount,'75.25');
 assert.equal(view.months[0].atrReferenceMonth,'');
 assert.equal(view.months[1].finance.discountAmount,'3000');
 assert.equal(view.months[1].billingAmount,'6431.46');
 assert.equal(view.totals.finance,contract.financialSummary.totals,'Keep server totals without recomputing monthly sums');
 assert.equal(contractMonthlyFinanceItems()[0].value,'—','Unavailable finance must not become zero');
 const pendingMetrics={...metrics,billingPending:true,grossAmount:'',netAmount:'',pendingAmount:''};
 const pendingItems=contractMonthlyFinanceItems(pendingMetrics);
 assert.match(pendingItems[0].value,/3\.000,00/);assert.match(pendingItems[2].value,/1\.200,00/);
 assert.equal(pendingItems[1].value,'Pendente');assert.equal(pendingItems[3].value,'Pendente');
 const {doc,fileName}=await createContractMonthlySummaryPdf(contract,brand),commands=doc.internal.pages.flat().join('\n');
 assert.equal(new TextDecoder().decode(new Uint8Array(doc.output('arraybuffer')).slice(0,4)),'%PDF');
 assert.equal(fileName,'resumo-contrato-12345678-2026-09-15.pdf');
 assert.ok(doc.getNumberOfPages()>=2,'The complete summary paginates the monthly tables and financial history.');
 for(const text of ['Resumo do contrato','Cliente mensal','CNPJ: 11.222.333/0001-81','Nº CTR-123/2026','Quantidade do contrato','Quantidade entregue','Falta entregar','Faturado bruto','Avanço do carregamento','Entregas, faturamento e entradas','Quantidade carregada por mês','Faturado e recebido por mês','Acordos de desconto','Nenhum acordo de desconto cadastrado.','Descontos','Valor líquido','Adiantamentos','Recebimentos','Total recebido','Saldo a receber','Crédito do contrato','3.000,00','3.431,46','1.200,00','2.231,46','75,25','42.000,00'])assert.ok(commands.includes(text),'PDF lost '+text);
 assert.ok(commands.indexOf('(Cliente mensal)')<commands.indexOf('(CNPJ: 11.222.333/0001-81)')&&commands.indexOf('(CNPJ: 11.222.333/0001-81)')<commands.indexOf('(Fornecimento'),'Client CNPJ must appear directly below the client name and before contract details');
 assert.doesNotMatch(commands,/A ajustar|Despesas|Dados essenciais|Condições do contrato/);
 const chartCommands=commands.slice(0,commands.indexOf('(Entregas e faturamento por mês)'));
 const chartText=[...chartCommands.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(match=>match[1]).join(' ');
 assert.ok(/Dez(?:\/|\s+)2024/.test(chartText),'The first month must remain visible in the charts for a contract longer than 12 months');
 assert.ok(/Fev(?:\/|\s+)2026/.test(chartText),'The last production month must remain visible in the charts');
 const zeroContract={...contract,financialSummary:undefined,contractedVolume:'0',loadedVolume:'0',remainingVolume:'0',billingAmount:'0',monthlySummary:{...contract.monthlySummary,months:[],totals:{...contract.monthlySummary.totals,contractedVolume:'0',loadedVolume:'0',remainingVolume:'0',billingAmount:'0'}}};
 const zeroResult=await createContractMonthlySummaryPdf(zeroContract,brand),zeroCommands=zeroResult.doc.internal.pages.flat().join('\n');
 assert.match(zeroCommands,/Avanço do carregamento/);
 assert.match(zeroCommands,/0%/);
 assert.match(zeroCommands,/Nenhuma movimentação/);
 const landscape=await createContractMonthlySummaryPdf(contract,{...brand,orientation:'landscape',header:{...brand.header,variant:'detailed'}});
 const landscapeCommands=landscape.doc.internal.pages.flat().join('\n');
 assert.match(landscapeCommands,/3\.431,46/);assert.match(landscapeCommands,/Fev\/2026/);assert.doesNotMatch(landscapeCommands,/A ajustar/);
 const company={id:'brand',name:'Empresa do relatório',legalName:'Empresa do relatório',cnpj:'11222333000181',street:'Rua da Fazenda',number:'123',complement:'Sala 01',district:'Centro',city:'Aracaju',state:'SE',zipCode:'49000000',phone:'79999990000',email:'contato@example.test',logoUrl:null};
 for(const orientation of ['portrait','landscape']){
  const result=await createContractMonthlySummaryPdf(contract,{...brand,orientation,company,header:{...brand.header,variant:'detailed'}});
  const pdf=result.doc,height=pdf.internal.pageSize.getHeight(),scale=pdf.internal.scaleFactor;
  for(const page of pdf.internal.pages.filter(Boolean))for(const command of page){
   if(/Emitido por|Página/.test(command))continue;
   const position=command.match(/([\d.]+) ([\d.]+) Td/);if(!position)continue;
   const lineHeight=Number(command.match(/([\d.]+) TL/)?.[1]??0),extraLines=(command.match(/T\*/g)??[]).length;
   const bottom=height-Number(position[2])/scale+extraLines*lineHeight/scale;
   assert.ok(bottom<height-19,'Report text must stay above the footer in '+orientation);
  }
 }
 const pendingContract={...contract,monthlySummary:{...contract.monthlySummary,months:[months[0]]},financialSummary:{months:[{...pendingMetrics,month:months[0].month}],totals:pendingMetrics,payments:[],discounts:[]}};
 const pendingReport=await createContractMonthlySummaryPdf(pendingContract,brand);
 const pendingCommands=pendingReport.doc.internal.pages.flat().join('\n');
 assert.match(pendingCommands,/Pendente/);assert.match(pendingCommands,/3\.000,00/);assert.match(pendingCommands,/1\.200,00/);
 const detail=await readFile('modules/contratos/components/ContractDetail.tsx','utf8'),summary=await readFile('modules/contratos/components/details/ContractSummaryTab.tsx','utf8'),form=await readFile('modules/contratos/forms/ContractForm.tsx','utf8');
 assert.match(detail,/>Exportar</);assert.doesNotMatch(summary,/ContractStages|Valor do contrato/);assert.doesNotMatch(form,/ContractStages|Valor total \(R\$\)/);
 console.log('Passed: monthly finance from RPC, discounts/net/receipts/pending, payment reference months, pending ATR, PDF portrait/landscape, charts and export.');
}finally{await rm(directory,{recursive:true,force:true});}
