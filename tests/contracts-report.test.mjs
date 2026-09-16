import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'contracts-report-'));
try{
 const output=join(directory,'contracts-report.mjs');
 await build({entryPoints:['modules/contratos/reporting/contractsPdf.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
 const {createContractsPdf}=await import(pathToFileURL(output));
 const contracts=Array.from({length:20},(_,index)=>({id:String(index),title:`Contrato ${index+1}`,contractNumber:`CTR-${index+1}`,companyId:'company',companyName:'Empresa A',companyCnpj:'',clientId:'client',clientName:`Cliente ${index+1}`,clientCnpj:'11222333000181',typeId:'type',typeName:'Fornecimento',stages:[],status:'Ativo',startDate:'2026-09-01',endDate:'',contractedVolume:'1000.125',atrPriceType:'net',atrPeriodType:'monthly',loadedVolume:'100.125',remainingVolume:'900',averageAtr:'121.5',billingAmount:'15000.25',billingPending:false,value:'',notes:'',createdAt:'',updatedAt:''}));
 const filters={bucket:'open',search:'Empresa A',from:'2026-09-01',to:'2026-09-30'};
 for(const [index,contract] of contracts.entries()){contract.atrQuoteSummary={average:'1.234567',pending:false,loadedMonths:['2026-09'],referenceMonths:['2026-08']};contract.financialTotals={grossAmount:'15000.25',discountAmount:'456.78',netAmount:'14543.47',receivedAmount:'1300.75',advanceAmount:'1000',pendingAmount:`13242.${String(index).padStart(2,'0')}`,creditAmount:'0',billingPending:false};}
 contracts[0].clientName='USINA COM NOME COMPRIDO PARA CONFERIR A QUEBRA COMPLETA DO CLIENTE LTDA';
 contracts[1].atrPeriodType='accumulated';contracts[1].atrPriceType='gross';contracts[1].atrQuoteSummary.average='1.987654';
 const company={id:'company',name:'AGRISUL AGRICOLA LTDA',legalName:'AGRISUL AGRICOLA LTDA',cnpj:'04773159000523',phone:'1132261428',email:'gerencia@example.test',street:'FAZENDA SANTA ANA',number:'S/N',complement:'ZONA RURAL',district:'CENTRO',city:'JAPOATA',state:'SE',zipCode:'49950000',logoUrl:null};
 const brand={orientation:'portrait',header:{variant:'detailed',logoAlignment:'left',showCnpj:true,showContact:true},company,watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'user',name:'Responsável',email:'responsavel@example.test'},issuedAt:new Date('2026-09-15T12:00:00Z')};
 const summary={loadedVolume:'2002.5',averageAtr:'1.234567',grossAmount:'123456.78',discountAmount:'2345.67',netAmount:'121111.11',advanceAmount:'1000',receiptAmount:'2000.75',receivedAmount:'3000.75',pendingAmount:'118110.36',creditAmount:'0',billingPending:false,pendingContractCount:0};
 const data={contracts,summary,total:20};
 const {doc,fileName}=await createContractsPdf({contracts,summary,total:contracts.length},filters,brand);
 const bytes=new Uint8Array(doc.output('arraybuffer'));
 const pageCommands=doc.internal.pages.flat().join('\n');
 assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'%PDF');
 assert.ok(doc.getNumberOfPages()>1);
 assert.ok(doc.internal.pageSize.getWidth()>doc.internal.pageSize.getHeight(),'This report must always use landscape, even when the global preference is portrait');
 assert.equal(fileName,'contratos-em-aberto-2026-09-15.pdf');
 assert.match(pageCommands,/AGRISUL AGRICOLA LTDA/);
 assert.match(pageCommands,/04\.773\.159\/0005-23/);
 assert.match(pageCommands,/FAZENDA SANTA ANA/);
 assert.match(pageCommands,/CENTRO/);
 assert.match(pageCommands,/JAPOATA/);
 assert.match(pageCommands,/gerencia@example\.test/);
 assert.match(pageCommands,/Volume carregado/);
 assert.match(pageCommands,/\(Cliente\) Tj/);
 assert.doesNotMatch(pageCommands,/Nº \/ Cliente/);
 assert.match(pageCommands,/CTR-1/);
 assert.match(pageCommands,/Faturado bruto/);
 assert.match(pageCommands,/ATR/);
 for(const value of ['1.000,13 t','900,00 t','121,50','1,234567','1,987654','456,78','14.543,47','1.300,75','1.000,00','13.242,00','Despesas²','Cotação média ATR¹','Mensal','Acumulado','Bruto','Líquido','Qtd. contratada','Qtd. pendente','Recebidos³','Adiantamentos³','A receber','Excedente recebido',...contracts[0].clientName.split(' ')])assert.ok(pageCommands.includes(value),`Missing report column value ${value}`);
 for(const value of ['2.002,50 t','1,2346','123.456,78','2.345,67','121.111,11','3.000,75','118.110,36'])assert.ok(pageCommands.includes(value),`PDF must present the RPC metric ${value} after formatting.`);
 for(const label of ['Volume carregado','Média ATR','Faturado bruto','Descontos','Líquido','Recebidos','Pendentes'])assert.ok(pageCommands.includes(label),`Missing KPI ${label}`);
 assert.match(pageCommands,/100,13 t/);
 const textX=label=>{const command=doc.internal.pages.flat().find(value=>value.includes(`(${label}) Tj`));assert.ok(command,`Texto ${label} não encontrado no PDF.`);const match=command.match(/([0-9.]+) [0-9.]+ Td/);assert.ok(match,`Coordenada de ${label} não encontrada.`);return Number(match[1]);};
 assert.ok(Math.abs(textX('Bairro:')-textX('CEP:'))<.01,'Bairro e CEP devem começar na mesma coluna.');
 for(const orientation of ['portrait','landscape']){
  const result=await createContractsPdf(data,{...filters,search:'Cliente '.repeat(25)},{...brand,orientation});
  assert.ok(result.doc.getNumberOfPages()>1);assert.ok(result.doc.internal.pageSize.getWidth()>result.doc.internal.pageSize.getHeight());
  const content=result.doc.internal.pages.flat().join('\n');
  for(const contract of contracts)assert.ok(content.includes(contract.contractNumber),`Pagination lost ${contract.contractNumber}`);
  for(const [index,contract] of contracts.entries()){
   const containingPages=result.doc.internal.pages.slice(1).filter(page=>page.some(command=>command.includes(`(${contract.contractNumber}) Tj`)));
   assert.equal(containingPages.length,1,'Each contract appears once');
   assert.ok(containingPages[0].join('\n').includes(`13.242,${String(index).padStart(2,'0')}`),'Both rows of the contract must remain on the same page');
  }
  for(const page of result.doc.internal.pages.slice(1)){
   const commands=page.join('\n');assert.ok(commands.includes('118.110,36'),'Repeat the filtered summary on every page');
   const lastBalance=page.filter(command=>/13\.242,/.test(command)).at(-1);
   if(lastBalance){const y=Number(lastBalance.match(/[\d.]+ ([\d.]+) Td/)[1]);assert.ok(y>24*72/25.4,'Financial rows must stay above the footer');}
  }
  const pending=await createContractsPdf({...data,contracts:[{...contracts[0],atrQuoteSummary:{average:'',pending:true,loadedMonths:['2026-09'],referenceMonths:['2026-08']},billingAmount:'',billingPending:true,financialTotals:{...contracts[0].financialTotals,netAmount:'',billingPending:true}}],summary:{...summary,averageAtr:'',grossAmount:'',netAmount:'',pendingAmount:'',billingPending:true,pendingContractCount:1}},filters,{...brand,orientation});
  const pendingContent=pending.doc.internal.pages.flat().join('\n');assert.ok(pendingContent.includes('Aguardando ATR'));assert.ok(pendingContent.includes('3.000,75'));assert.ok(pendingContent.includes('1.300,75'));assert.ok(pendingContent.includes('1.000,00'));assert.ok(!pendingContent.includes('118.110,36'));assert.ok(!pendingContent.includes('13.242,00'));assert.ok(pendingContent.includes('456,78'));assert.ok(!pendingContent.includes('14.543,47'));assert.ok(!pendingContent.includes('1,234567'));
 }
 const credit=await createContractsPdf({...data,contracts:[{...contracts[0],financialTotals:{...contracts[0].financialTotals,receivedAmount:'20000',advanceAmount:'18000',pendingAmount:'0',creditAmount:'5456.53'}}]},filters,brand);
 const creditContent=credit.doc.internal.pages.flat().join('\n');
 for(const value of ['20.000,00','18.000,00','5.456,53'])assert.ok(creditContent.includes(value),'Show received, advance and excess independently');
 const empty=await createContractsPdf({contracts:[],total:0,summary:{...summary,loadedVolume:'0',averageAtr:'',grossAmount:'0',discountAmount:'0',netAmount:'0',receivedAmount:'0',pendingAmount:'0'}},{bucket:'finished',search:'Ausente',from:'',to:''},brand);
 assert.equal(empty.doc.getNumberOfPages(),1);assert.ok(empty.doc.internal.pages.flat().join('\n').includes('Nenhum contrato encontrado'));
 console.log('Passed: two rows per contract, quantities, receipts/advances/excess, pending ATR, full names, filtered KPIs and indivisible contract pagination above the footer.');
}finally{await rm(directory,{recursive:true,force:true});}
