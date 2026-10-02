import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
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
 const metrics={loadedVolume:'250',averageAtr:'121.5',grossAmount:'150000.75',grossPerTon:'600.003',discountAmount:'2000.25',netAmount:'148000.50',netPerTon:'592.002',advanceAmount:'25000.15',receiptAmount:'35000.35',refundedAmount:'0',receivedAmount:'60000.50',pendingAmount:'88000',creditAmount:'0',refundableAmount:'0',billingPending:false};
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
 assert.equal(model.salePerTon.gross,'R$ 600,00/t');
 assert.equal(model.salePerTon.net,'R$ 592,00/t');
 const heroSource=await readFile('modules/contratos/components/details/ContractSummaryHero.tsx','utf8');
 const pdfSource=await readFile('modules/contratos/reporting/contractSummaryPdfDocument.ts','utf8');
 const chartSource=await readFile('modules/contratos/reporting/contractSummaryPdfCharts.ts','utf8');
 const detailSource=await readFile('modules/contratos/components/ContractDetail.tsx','utf8');
 const summaryFinancialSource=await readFile('modules/contratos/components/details/ContractSummaryFinancialOverview.tsx','utf8');
 const reportDialogSource=await readFile('modules/contratos/components/ContractMonthlyReportDialog.tsx','utf8');
 const monthlyChartsSource=await readFile('modules/contratos/components/details/ContractMonthlyCharts.tsx','utf8');
 const heroOrder=['Quantidade do contrato','Quantidade entregue','summary.operationalItems[3].label','Falta entregar'].map(value=>heroSource.indexOf(value));
 assert.ok(heroOrder.every((position,index)=>position>=0&&(index===0||position>heroOrder[index-1])),'Hero KPI rows must keep contract/received, delivered/pending, ATR/sale-per-ton, remaining/credit order');
 assert.match(heroSource,/balances=\[money\[0\],money\[1\],null,money\[2\]\]/);
 assert.doesNotMatch(heroSource,/Quantidade entregue[^\n]+ATR médio/);
 assert.match(heroSource,/label:'Falta entregar'/,'The eighth hero KPI must keep the remaining contract volume');
 assert.match(chartSource,/row\.averageAtr/,'The PDF daily line must use the server-calculated ATR for each day');
 assert.match(chartSource,/setLineDashPattern\(\[1\.3,1\],0\)/,'The PDF daily ATR line must be dotted');
 assert.match(pdfSource,/contractDailyLoadsChartRows\(dailyLoads,granularity\)/,'The PDF must aggregate the chart with the selected screen granularity');
 // Real bar counts, geometry, colors and bounds are exercised by contract-chart-density.test.mjs.
 const pdfDailyChartSource=chartSource.slice(chartSource.indexOf('export function drawContractLoadPdfChart'),chartSource.indexOf('export function drawContractFinancialPdfChart'));
 assert.match(pdfDailyChartSource,/Math\.min\(8\.5,slot\*\.38\)/,'The operational PDF chart must keep narrow bars');
 assert.match(chartSource,/ink:\[23,37,29\]/,'The operational PDF chart must use high-contrast dark text');
 assert.match(chartSource,/else doc\.rect\(x,y-2\.1,3,2\.6,'F'\)/,'The PDF legend must draw a real quantity swatch');
 const pdfSectionOrder=['hero();','financialOverview();','dailyChart();','charts();'].map(call=>pdfSource.indexOf(call));
 assert.ok(pdfSectionOrder.every((position,index)=>position>=0&&(index===0||position>pdfSectionOrder[index-1])),'The PDF must mirror the screen order: operational, financial, load evolution and delivery/billing summary');
 const pdfFinancialChartSource=chartSource.slice(chartSource.indexOf('export function drawContractFinancialPdfChart'));
 assert.match(pdfDailyChartSource,/label:'ATR \(kg\/t\)'/,'ATR values must remain in their own readable band');
 assert.doesNotMatch(pdfFinancialChartSource,/atrValues|atrScaleMinimum|const points=|granularityCopy\.atr|point\.label|setLineDashPattern\(\[1\.2,1\],0\)/,'The lower PDF financial chart must not draw an ATR series, axis, point label or legend');
 assert.doesNotMatch(pdfFinancialChartSource,/rows\.slice\(/,'All selected financial buckets must remain in one chart');
 assert.doesNotMatch(pdfFinancialChartSource,/contractDailyLoadsChartPages/,'Financial pagination must not repeat a boundary bucket after removing its line');
 assert.match(pdfFinancialChartSource,/bar\(doc,center,base,barWidth,[\s\S]+bar\(doc,center,base,barWidth,/,'Gross and net must use the same narrow x position and width in the composed PDF bar');
 assert.doesNotMatch(pdfFinancialChartSource,/netWidth|center-netWidth/,'The net amount must never become a narrower or side-by-side PDF bar');
 assert.match(pdfFinancialChartSource,/row\.gross===null\|\|row\.net===null\?'Pendente':money\(row\.net\)/,'The PDF financial chart must render explicit pending and zero states');
 assert.match(pdfFinancialChartSource,/maximum>0\|\|value===0/,'An all-zero or pending PDF page must print only the R$ 0 axis tick');
 assert.match(pdfSource,/contractLoadFinancialChartRows\(dailyLoads,granularity\)/,'The PDF financial chart must reuse the selected upper period and granularity');
 assert.match(chartSource,/Faturado bruto \(barra total\)/,'The PDF legend must explain that gross is the complete bar');
 assert.match(chartSource,/Líquido \(preenchimento interno\)/,'The PDF legend must explain that net is drawn inside gross');
 assert.match(pdfFinancialChartSource,/barWidth=Math\.min\(8\.5,slot\*\.38\)/,'The PDF financial bars must stay narrow');
 assert.doesNotMatch(pdfFinancialChartSource,/netWidth/,'The net fill must use exactly the same width as the gross bar');
 assert.match(chartSource,/roundedRect\(center-width\/2,base-height,width,height/,'Both fills must use the shared composite-bar geometry');
 assert.doesNotMatch(pdfSource,/value>=1000[^\n]+['"]k['"]|['"] mil['"]|['"] mi['"]/,'The PDF financial chart must not abbreviate currency values');
 assert.doesNotMatch(pdfSource,/variationPercent|Variação percentual/,'The PDF must not reuse the obsolete percentage series');
 assert.match(detailSource,/dailyPeriod=\{dailyPeriod\}/,'The summary PDF must receive the daily period currently selected on screen');
 assert.match(detailSource,/onDailyPeriod=\{changeDailyPeriod\}/,'The daily date filter must synchronize the monthly summary');
 assert.match(detailSource,/const monthlyPeriod=contractMonthlyPeriodFromDateRange\(dailyPeriod\)/,'The monthly tables must derive their month range from the single upper filter');
 assert.doesNotMatch(detailSource,/useState<ContractMonthlyPeriod>/,'There must not be a second period state for the lower summary');
 assert.match(summaryFinancialSource,/<ContractMonthlyCharts data=\{dailyLoads\.data\} period=\{dailyPeriod\}/,'The lower financial chart must consume the same filtered loads and granularity as the upper chart');
 assert.match(monthlyChartsSource,/function CompositeMoneyBar[\s\S]+contract-monthly-gross-bar[\s\S]+contract-monthly-net-bar/,'The financial screen chart must keep one gross bar with net filled inside');
 assert.match(monthlyChartsSource,/formatContractBilling\(String\(row\.gross\)\)/,'The financial tooltip must preserve exact gross BRL values');
 assert.match(monthlyChartsSource,/formatContractBilling\(String\(row\.net\)\)/,'The financial tooltip must preserve exact net BRL values');
 assert.match(monthlyChartsSource,/grossPlot:row\.gross!==null&&row\.gross>0\?row\.gross:emptyPlot/,'The financial screen chart must reserve a visible state for zero and pending buckets');
 assert.match(monthlyChartsSource,/<Tooltip filterNull=\{false\}/,'The financial tooltip must remain available for pending buckets');
 assert.match(monthlyChartsSource,/hasPositiveGross=rows\.some[\s\S]+ticks=\{hasPositiveGross\?undefined:\[0\]\}/,'The financial screen axis must show only R$ 0 when every bucket is zero or pending');
 assert.doesNotMatch(monthlyChartsSource,/dataKey="atr"|yAxisId="atr"|ATR médio|contract-monthly-atr/,'The financial screen chart must not draw or describe a second ATR series');
 assert.match(reportDialogSource,/\{search:'',from:dailyPeriod\.from,to:dailyPeriod\.to,groupBy:'day'\}/,'The PDF query must use the visible dates without sending presentation granularity to the RPC');
 assert.match(reportDialogSource,/dailyLoads\.data,dailyPeriod/,'The PDF must receive the granularity currently selected on screen');
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
 assert.deepEqual(noFinance.salePerTon,{label:'Valor de venda por tonelada',gross:'—',net:'—'});
 const brand={orientation:'portrait',header:{variant:'detailed',logoAlignment:'left',showCnpj:true,showContact:true},company:null,watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'user',name:'Responsável',email:'responsavel@example.test'},issuedAt:new Date('2026-09-15T12:00:00Z')};
 const textCommands=commands=>commands.flatMap(command=>[...command.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map(match=>match[1].replace(/\\([\\()])/g,'$1')));
 const assertFooterSafety=(doc,orientation)=>{
  for(const page of doc.internal.pages.slice(1))for(const command of page){
   if(!command.includes(' Tj')||/Emitido por|Página/.test(command))continue;
   const position=command.match(/[-\d.]+ ([-\d.]+) Td/),leading=command.match(/([-\d.]+) TL/);
   if(position){const lastY=Number(position[1])-(command.match(/T\*/g)?.length??0)*Number(leading?.[1]??0);assert.ok(lastY>23*72/25.4,'Body text must stay above the footer in '+orientation);}
  }
 };
 const assertSingleOperationalChart=(doc,groups,orientation)=>{
  const pages=doc.internal.pages.slice(1),title='Quantidade carregada por dia';
  assert.equal(pages.flatMap(textCommands).filter(text=>text===title).length,1,`${orientation}: ${groups.length} days must produce one operational chart panel`);
  const page=pages.find(commands=>textCommands(commands).includes(title));
  assert.ok(page,`${orientation}: the operational chart must be present`);
  const start=page.findIndex(command=>command.includes('EVOLUÇÃO DOS CARREGAMENTOS'));
  const following=page.findIndex((command,index)=>index>start&&(/RESUMO MENSAL|Entregas e faturamento por mês|Entradas e saldos por mês|Observações do contrato/.test(command)));
  const labels=textCommands(page.slice(start,following<0?page.length:following));
  const sampled=labels.some(text=>text.includes('rótulos a cada'));
  for(const group of groups){
   const label=group.key.slice(8,10)+'/'+group.key.slice(5,7),atr=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(group.averageAtr));
   if(sampled&&!labels.includes(label))continue;
   assert.equal(labels.filter(text=>text===label).length,1,`${orientation}: ${label} must appear once in the complete chart on one page`);
   const matchingAtrCount=groups.filter(row=>Number(row.averageAtr)===Number(group.averageAtr)).length;
   assert.equal(labels.filter(text=>text===atr).length,matchingAtrCount,`${orientation}: ${label} must retain its daily ATR label without pagination duplicates`);
  }
  for(const group of [groups[0],groups.at(-1)])assert.ok(labels.includes(group.key.slice(8)+'/'+group.key.slice(5,7)),'First and final selected days must stay visible');
  assertFooterSafety(doc,orientation);
 };
 const pricedLoad=(id,loadedAt,volume,atr,grossAmount,discountAmount,netAmount)=>({id,contractId:contract.id,loadedAt,farmId:'farm',plotId:'plot',farmName:'Fazenda teste',plotName:'Talhão teste',volume,atr,atrReferenceMonth:'2026-09',atrQuote:'1.2',grossAmount,discountAmount,netAmount,billingPending:false,document:'',notes:'',createdAt:'',updatedAt:''});
 // Model a synthetic RPC response. Production rendering must consume these
 // precomputed fields, never repeat these fixture calculations in the frontend.
 const fixtureFarms=groups=>{
  const loads=groups.flatMap(group=>group.loads),pending=loads.some(load=>load.billingPending);
  const total=key=>loads.reduce((sum,load)=>sum+Number(load[key]||0),0).toFixed(2);
  return loads.length?[{id:'farm',name:'Fazenda teste',loadCount:loads.length,volume:total('volume'),grossAmount:pending?'':total('grossAmount'),netAmount:pending?'':total('netAmount'),billingPending:pending}]:[];
 };
 const firstLoad=pricedLoad('load-1','2026-09-15','100','120','60000.30','800.10','59200.20'),secondLoad=pricedLoad('load-2','2026-09-16','150','122.5','90000.45','1200.15','88800.30');
 const dailyLoads={filters:{search:'',from:'2026-09-01',to:'2026-09-30',groupBy:'day'},summary:{loadCount:2,volume:'250',farmCount:1,plotCount:1,activeDayCount:2,monthCount:1,averageDailyVolume:'125',averageAtr:'121.5',firstLoadedAt:'2026-09-15',lastLoadedAt:'2026-09-16',grossAmount:'150000.75',discountAmount:'2000.25',netAmount:'148000.50',billingPending:false},monthlyVolumes:[{month:'2026-09',volume:'250',loadCount:2}],groups:[{key:'2026-09-15',label:'2026-09-15',loadCount:1,volume:'100',averageAtr:'120',loads:[firstLoad]},{key:'2026-09-16',label:'2026-09-16',loadCount:1,volume:'150',averageAtr:'122.5',loads:[secondLoad]}]};
 const dailyDayPeriod={from:'2026-09-01',to:'2026-09-30',granularity:'day'};
 dailyLoads.farms=fixtureFarms(dailyLoads.groups);
 await assert.rejects(()=>createContractMonthlySummaryPdf(contract,brand,undefined,{...dailyLoads,farms:undefined},dailyDayPeriod),/totais por fazenda/,'A stale backend response must not silently fabricate farm totals');
 const longContract={...contract,notes:('Orientação comercial detalhada. '.repeat(120)+'FIM-DAS-OBSERVACOES'),financialSummary:{...contract.financialSummary,payments:Array.from({length:45},(_,index)=>({...payment,id:'payment-'+index,document:'RECIBO-'+String(index).padStart(3,'0'),notes:index===4?'Detalhes do comprovante. '.repeat(40)+'FIM-DO-COMPROVANTE':'Entrada confirmada.'})),discounts:[{...discount,notes:'Condições do acordo. '.repeat(45)+'FIM-DO-ACORDO'}]}};
 for(const orientation of ['portrait','landscape']){
  const {doc}=await createContractMonthlySummaryPdf(longContract,{...brand,orientation},undefined,dailyLoads,dailyDayPeriod);
  const commands=doc.internal.pages.flat().join('\n');
  for(const text of ['Avanço do carregamento','Quantidade carregada por dia','ATR médio diário','Média diária 125,00 t','15/09','16/09','Valor de venda por tonelada','Bruto','600,00/t','Líquido:','592,00/t','Da entrega ao recebimento','Faturamento bruto e líquido por dia','Faturado bruto','Líquido','60.000,30','59.200,20','ATR médio','Quantidade entregue','Acordos de desconto','Valor por tonelada','Meses de aplicação','Base entregue','Desconto total','Adiantamentos','Recebimentos','Estornos','Total recebido','Crédito do contrato','Falta entregar','25.000,15','35.000,35','60.000,50','88.000,00','8,001/t','Ago/2026','Out/2026','RECIBO-044','FIM-DO-COMPROVANTE','FIM-DO-ACORDO','FIM-DAS-OBSERVACOES'])assert.ok(commands.includes(text),orientation+' lost '+text);
  assertSingleOperationalChart(doc,dailyLoads.groups,orientation);
  const chartPages=doc.internal.pages.slice(1).map(textCommands);
  const operationalIndex=chartPages.findIndex(text=>text.includes('Quantidade carregada por dia'));
  const financialIndex=chartPages.findIndex(text=>text.includes('Faturamento bruto e líquido por dia'));
  assert.ok(operationalIndex>0,'The operational chart must have a dedicated page after the overview');
  assert.equal(financialIndex,operationalIndex+1,'The financial chart must occupy the following dedicated page');
  assert.ok(chartPages[financialIndex+1].includes('RESULTADO POR FAZENDA'),'Farm results must occupy the page immediately after the financial chart');
  for(const text of ['Fazenda teste','250','150.000,75','148.000,50'])assert.ok(chartPages[financialIndex+1].includes(text),'The farm page lost an official fixture field '+text);
  assert.ok(chartPages[financialIndex+2].includes('Entregas e faturamento por mês'),'Tables must follow the farm results page');
  assert.ok(!commands.includes('Variação percentual'),orientation+' kept the obsolete percentage legend');
  assert.doesNotMatch(commands,/A ajustar|Dados essenciais|Condições do contrato/);
  assert.ok(doc.getNumberOfPages()>2);
  if(orientation==='portrait'){
   const firstPageCommands=doc.internal.pages[1].join('\n');
   const firstPageOrder=['Avanço do carregamento','Da entrega ao recebimento'].map(text=>firstPageCommands.indexOf(text));
   assert.ok(firstPageOrder.every((position,index)=>position>=0&&(index===0||position>firstPageOrder[index-1])),'Portrait page one must preserve the operational and financial overview order');
   assert.ok(!firstPageCommands.includes('Quantidade carregada por dia'),'The expanded chart must not be compressed into the portrait overview page');
  }
  assertFooterSafety(doc,orientation);
  if(process.env.BILLING_SUMMARY_ARTIFACTS){const folder=resolve(process.env.BILLING_SUMMARY_ARTIFACTS);await mkdir(folder,{recursive:true});await writeFile(join(folder,'resumo-'+orientation+'.pdf'),new Uint8Array(doc.output('arraybuffer')));await writeFile(join(folder,'contract.json'),JSON.stringify(contract));}
 }
 const weeklyPeriod={...dailyDayPeriod,granularity:'week'};
 const intervalContract={...contract,financialSummary:{...contract.financialSummary,payments:[],refunds:[],discounts:[]}};
 const {doc:weeklyDoc}=await createContractMonthlySummaryPdf(intervalContract,brand,{from:'2026-08',to:'2026-10'},dailyLoads,weeklyPeriod),weeklyCommands=weeklyDoc.internal.pages.flat().join('\n');
 for(const text of ['Quantidade carregada por semana','ATR médio semanal','121,5','Média semanal 250,00 t','Faturamento bruto e líquido por semana','150.000,75','148.000,50','Período: 01/09/2026 a 30/09/2026'])assert.ok(weeklyCommands.includes(text),'Weekly PDF lost '+text);
 assert.ok(!weeklyCommands.includes('Out/2026'),'The shared daily interval must exclude October from the PDF monthly summary');
 for(const dayCount of [1,9,11,15,31,90]){
  const groups=Array.from({length:dayCount},(_,index)=>{
   const date=new Date(Date.UTC(2026,8,index+1)).toISOString().slice(0,10),atr=String(110+index);
   return {key:date,label:date,loadCount:1,volume:'50',averageAtr:atr,loads:[pricedLoad('dense-'+index,date,'50',atr,'1234.56','234.55','1000.01')]};
  });
  const loads={...dailyLoads,summary:{...dailyLoads.summary,loadCount:dayCount,volume:String(dayCount*50),activeDayCount:dayCount,averageDailyVolume:'50'},groups};
  loads.farms=fixtureFarms(groups);
  for(const orientation of ['portrait','landscape']){
   const {doc}=await createContractMonthlySummaryPdf(contract,{...brand,orientation},undefined,loads,dailyDayPeriod);
   assertSingleOperationalChart(doc,loads.groups,orientation);
   const pages=doc.internal.pages.slice(1).map(textCommands),title='Faturamento bruto e líquido por dia';
   assert.equal(pages.flat().filter(text=>text===title).length,1,`${orientation}: ${dayCount} financial buckets must stay in one panel`);
   const financialPage=pages.find(text=>text.includes(title));
   const displayedGroups=financialPage.some(text=>text.includes('rótulos a cada'))?[groups[0],groups.at(-1)]:groups;
   for(const group of displayedGroups)assert.ok(financialPage.includes(group.key.slice(8)+'/'+group.key.slice(5,7)),`${orientation}: financial chart lost ${group.key}`);
  }
 }
 const screenshotPeriod={from:'2026-09-18',to:'2026-10-02',granularity:'day'};
 const screenshotCompany={id:'company',name:'AGRISUL AGRICOLA LTDA EM RECUPERACAO JUDICIAL',legalName:'AGRISUL AGRICOLA LTDA EM RECUPERACAO JUDICIAL',cnpj:'04773159000523',phone:'1132261428',email:'',street:'FAZENDA FAZENDA SANTANA',number:'S/N',complement:'',district:'ZONA RURAL',city:'Japoatã',state:'SE',zipCode:'49950000',logoUrl:null};
 const screenshotMetrics={...metrics,loadedVolume:'3313.43',averageAtr:'122.5677',grossAmount:'519182.95',grossPerTon:'156.69',discountAmount:'248507.25',netAmount:'270675.70',netPerTon:'81.69',advanceAmount:'0',receiptAmount:'0',refundedAmount:'0',receivedAmount:'0',pendingAmount:'270675.70',creditAmount:'0'};
 const screenshotContract={...contract,companyName:screenshotCompany.name,clientName:'USINA SAO JOSE DO PINHEIRO LTDA',clientCnpj:'13324215000100',contractNumber:'',typeName:'Contrato Semiautomático',contractedVolume:'40000',loadedVolume:'3313.43',remainingVolume:'36686.57',averageAtr:'122.5677',monthlySummary:{...contract.monthlySummary,totals:{...contract.monthlySummary.totals,contractedVolume:'40000',loadedVolume:'3313.43',remainingVolume:'36686.57',averageLoadAtr:'122.5677'}},financialSummary:{...contract.financialSummary,totals:screenshotMetrics}};
 const screenshotDailyLoads={...dailyLoads,filters:{...dailyLoads.filters,from:screenshotPeriod.from,to:screenshotPeriod.to},summary:{...dailyLoads.summary,loadCount:11,volume:'2843.67',activeDayCount:11,averageDailyVolume:'258.52',averageAtr:'121.73',firstLoadedAt:'2026-09-18',lastLoadedAt:'2026-09-30'},groups:[['18','142.75','118.75'],['21','192.12','121.06'],['22','482.09','123.49'],['23','201.90','124.89'],['24','274.61','115.76'],['25','316.65','113.92'],['26','189.18','117.09'],['27','285.76','117.09'],['28','228.81','127.83'],['29','306.33','136.23'],['30','223.47','119.70']].map(([day,volume,atr])=>{
  const loadedAt='2026-09-'+day,load=pricedLoad('screenshot-'+day,loadedAt,volume,atr,(Number(volume)*156.69).toFixed(2),(Number(volume)*75).toFixed(2),(Number(volume)*81.69).toFixed(2));
  return {key:loadedAt,label:loadedAt,loadCount:1,volume,averageAtr:atr,loads:[load]};
 })};
 screenshotDailyLoads.farms=fixtureFarms(screenshotDailyLoads.groups);
 for(const orientation of ['portrait','landscape']){
  const {doc}=await createContractMonthlySummaryPdf(screenshotContract,{...brand,orientation,company:screenshotCompany},undefined,screenshotDailyLoads,screenshotPeriod);
  assertSingleOperationalChart(doc,screenshotDailyLoads.groups,orientation);
  const firstPage=doc.internal.pages[1],firstPageText=textCommands(firstPage),heroPosition=firstPageText.indexOf('Avanço do carregamento'),financePosition=firstPageText.indexOf('Da entrega ao recebimento');
  assert.ok(heroPosition>=0&&financePosition>heroPosition,`${orientation}: the detailed company header must leave the financial overview below the hero on page one`);
  const financeStart=firstPage.findIndex(command=>command.includes('VISÃO FINANCEIRA'));
  const following=firstPage.findIndex((command,index)=>index>financeStart&&command.includes('EVOLUÇÃO DOS CARREGAMENTOS'));
  const financeLabels=textCommands(firstPage.slice(financeStart,following<0?firstPage.length:following)).map(text=>text.replace(/\s+/g,' ')),financeText=financeLabels.join(' ');
  for(const item of contractSummaryDetails(screenshotContract).financialItems.filter(item=>['gross','discount','net','advance','receipt','refund'].includes(item.key))){
   const labelPosition=financeLabels.indexOf(item.label);
   assert.ok(labelPosition>=0,`${orientation}: first-page finance lost ${item.label}`);
   assert.equal(financeLabels[labelPosition+1],item.value.replace(/\s+/g,' '),`${orientation}: first-page finance lost the value for ${item.label}`);
  }
  assert.ok(financeText.includes('O total recebido considera adiantamentos e recebimentos, menos os estornos.'),`${orientation}: first-page finance must retain the receipt explanation`);
  assert.ok(financeText.includes('o saldo geral é o do contrato inteiro.'),`${orientation}: first-page finance must retain the contract balance explanation`);
  if(process.env.BILLING_SUMMARY_ARTIFACTS){const folder=resolve(process.env.BILLING_SUMMARY_ARTIFACTS);await mkdir(folder,{recursive:true});await writeFile(join(folder,'resumo-captura-'+orientation+'.pdf'),new Uint8Array(doc.output('arraybuffer')));}
 }
 for(const orientation of ['portrait','landscape'])for(const availability of ['pending','unavailable']){
  const noticeContract={...screenshotContract,financialSummary:availability==='unavailable'?undefined:{...screenshotContract.financialSummary,totals:{...screenshotMetrics,billingPending:true,grossAmount:'',netAmount:'',pendingAmount:'',creditAmount:''}}};
  const {doc}=await createContractMonthlySummaryPdf(noticeContract,{...brand,orientation,company:screenshotCompany},undefined,screenshotDailyLoads,screenshotPeriod);
  const firstPageText=textCommands(doc.internal.pages[1]).join(' ').replace(/\s+/g,' '),notice=contractSummaryDetails(noticeContract).notice.replace(/\s+/g,' ');
  assert.ok(firstPageText.includes('Da entrega ao recebimento'),`${orientation}: ${availability} finance must stay below the hero on page one`);
  assert.ok(notice&&firstPageText.includes(notice),`${orientation}: the complete ${availability} finance notice must stay on page one`);
  assertFooterSafety(doc,orientation);
 }
 const sevenFinancialLoads={...dailyLoads,summary:{...dailyLoads.summary,loadCount:7,volume:'700',activeDayCount:7,averageDailyVolume:'100'},groups:Array.from({length:7},(_,index)=>{const day=String(index+1).padStart(2,'0'),load=pricedLoad(`financial-${day}`,`2026-09-${day}`,'100',String(120+index),String(60000+index),String(1000+index),String(59000+index));return {key:load.loadedAt,label:load.loadedAt,loadCount:1,volume:load.volume,averageAtr:load.atr,loads:[load]};})};
 sevenFinancialLoads.farms=fixtureFarms(sevenFinancialLoads.groups);
 const {doc:financialPagedDoc}=await createContractMonthlySummaryPdf(contract,brand,undefined,sevenFinancialLoads,dailyDayPeriod),financialPagedCommands=financialPagedDoc.internal.pages.flat().join('\n');
 assert.equal(financialPagedCommands.match(/Faturamento bruto e líquido por dia/g)?.length,1,'Seven financial buckets must fit in a single complete panel');
 assert.equal(financialPagedCommands.match(/06\/09/g)?.length,2,'The sixth period must appear once in the upper chart and once in the financial chart, without a repeated boundary bar');
 assert.equal(financialPagedCommands.match(/07\/09/g)?.length,2,'The final financial period must render exactly once alongside its upper-chart counterpart');
 const zeroLoad=pricedLoad('zero-load','2026-09-20','10','120','0','0','0'),pendingLoad={...pricedLoad('pending-load','2026-09-21','10','120','','',''),billingPending:true};
 const zeroPendingLoads={...dailyLoads,groups:[{key:zeroLoad.loadedAt,label:zeroLoad.loadedAt,loadCount:1,volume:zeroLoad.volume,averageAtr:zeroLoad.atr,loads:[zeroLoad]},{key:pendingLoad.loadedAt,label:pendingLoad.loadedAt,loadCount:1,volume:pendingLoad.volume,averageAtr:pendingLoad.atr,loads:[pendingLoad]}]};
 zeroPendingLoads.farms=fixtureFarms(zeroPendingLoads.groups);
 const {doc:zeroPendingDoc}=await createContractMonthlySummaryPdf(contract,brand,undefined,zeroPendingLoads,dailyDayPeriod),zeroPendingCommands=zeroPendingDoc.internal.pages.flat().join('\n');
 assert.ok(zeroPendingCommands.includes('Líquido \\(R$\\)')&&zeroPendingCommands.includes('(0,00)'),'The financial PDF must identify zero net in its exact-value row');
 assert.ok(zeroPendingCommands.includes('Pendente'),'The financial PDF must identify pending billing explicitly');
 for(const artificialTick of ['R$ 0,25','R$ 0,50','R$ 0,75','R$ 1,00'])assert.ok(!zeroPendingCommands.includes(artificialTick),'The all-zero/pending financial axis must not render '+artificialTick);
 const officialFarms=[{id:'official',name:'Fazenda de totais oficiais',loadCount:99,volume:'9876.54',grossAmount:'123456.78',netAmount:'65432.10',billingPending:false}];
 const officialSnapshot=JSON.stringify(officialFarms);
 const {doc:officialDoc}=await createContractMonthlySummaryPdf(contract,brand,undefined,{...dailyLoads,farms:officialFarms},dailyDayPeriod);
 const officialPage=officialDoc.internal.pages.slice(1).map(textCommands).find(text=>text.includes('RESULTADO POR FAZENDA'));
 for(const expected of ['9.876,54','123.456,78','65.432,10'])assert.ok(officialPage.includes(expected),'The PDF must consume official farm totals without recalculating from daily loads');
 assert.equal(JSON.stringify(officialFarms),officialSnapshot,'Official farm totals must remain immutable');
 console.log('Passed: nine financial indicators, delivery balance, payment-only months, credits, unavailable/pending states, RPC totals, full histories, long notes and PDF footer safety in both orientations.');
}finally{await rm(directory,{recursive:true,force:true});}
