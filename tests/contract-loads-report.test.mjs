import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]})),directory=await mkdtemp(join(tmpdir(),'loads-report-'));
try{
 const output=join(directory,'report.mjs');
 await build({entryPoints:['modules/contratos/reporting/contractTabPdf.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
 const {createContractTabPdf,loadsReportModel,financialReportModel}=await import(pathToFileURL(output));
 const loads=Array.from({length:70},(_,i)=>({id:String(i),farmName:'Fazenda Aurora',plotName:'Talhão 01',loadedAt:'2026-02-15',volume:'1.125',atr:'120',atrReferenceMonth:'2026-01',grossAmount:'987.65',discountAmount:'23.45',netAmount:'964.20',billingPending:false,document:'TICKET-'+i,notes:i===69?'Observação final preservada no relatório':''}));
 const data={filters:{search:'Aurora',from:'2026-02-01',to:'2026-02-28',groupBy:'farm'},summary:{volume:'1234.567',loadCount:70,farmCount:1,plotCount:1,averageAtr:'125.75',grossAmount:'123456.78',discountAmount:'3456.78',netAmount:'120000',billingPending:false},groups:[{key:'a',label:'Fazenda Aurora',loadCount:70,volume:'1234.567',averageAtr:'125.75',loads}]};
 const model=loadsReportModel(data);
 assert.deepEqual(model.columns.slice(-3),['Faturamento','Desconto','Valor líquido']);
 assert.deepEqual(model.groups[0].rows[0].slice(-3).map(value=>value.replace(/\u00a0/g,' ')),['R$ 987,65','R$ 23,45','R$ 964,20'],'Financial columns preserve RPC amounts without client calculations');
 const pending=loadsReportModel({...data,groups:[{...data.groups[0],loads:[{...loads[0],grossAmount:'',netAmount:'',billingPending:true}]}]});
 assert.deepEqual(pending.groups[0].rows[0].slice(-3).map(value=>value.replace(/\u00a0/g,' ')),['Pendente','R$ 23,45','Pendente'],'Missing ATR keeps the known discount visible');
 const stale=loadsReportModel({...data,groups:[{...data.groups[0],loads:[{...loads[0],grossAmount:undefined,discountAmount:undefined,netAmount:undefined,billingPending:undefined}]}]});
 assert.deepEqual(stale.groups[0].rows[0].slice(-3),['Pendente','Pendente','Pendente'],'Older snapshots cannot invent zero financial amounts');
 assert.equal(model.metrics[0].value,'1.234,57 t','Exports use the server snapshot without adding client-side quantities');
 assert.equal(model.metrics.length,7);
 assert.deepEqual(model.metrics.slice(-3).map(metric=>[metric.label,metric.value.replace(/\u00a0/g,' ')]),[['Faturamento','R$ 123.456,78'],['Descontos','R$ 3.456,78'],['Valor líquido','R$ 120.000,00']],'PDF KPIs use the filtered summary, independently of table rows');
 const pendingKpis=loadsReportModel({...data,summary:{...data.summary,grossAmount:'',netAmount:'',billingPending:true}});
 assert.deepEqual(pendingKpis.metrics.slice(-3).map(metric=>metric.value.replace(/\u00a0/g,' ')),['Pendente','R$ 3.456,78','Pendente']);
 assert.match(model.criteria,/01\/02\/2026 a 28\/02\/2026/);assert.match(model.criteria,/Busca: Aurora/);assert.match(model.criteria,/Por fazenda/);
 const contract={id:'12345678-1234-4234-8234-123456789012',clientName:'Usina teste',contractNumber:'CTR-1',atrPriceType:'gross',atrPeriodType:'monthly',billingAmount:'1',billingPending:false,status:'Ativo'};
 const brand={orientation:'portrait',header:{variant:'compact',logoAlignment:'left',showCnpj:true,showContact:true},company:null,watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'user',name:'Responsável',email:'responsavel@example.test'},issuedAt:new Date('2026-09-15T12:00:00Z')};
 for(const orientation of ['portrait','landscape']){
  const {doc,fileName}=await createContractTabPdf(contract,model,{...brand,orientation}),commands=doc.internal.pages.flat().join('\n');
  assert.ok(doc.getNumberOfPages()>1);assert.match(fileName,/^carregamentos-contrato-/);
  assert.match(commands,/Carregamentos do contrato/);assert.match(commands,/TICKET-69/);assert.match(commands,/1.234,57 t/);assert.doesNotMatch(commands,/Resumo do contrato/);
  for(const amount of ['987,65','23,45','964,20'])assert.ok(commands.includes(amount),`Load PDF includes ${amount} in ${orientation}`);
  for(const amount of ['123.456,78','3.456,78','120.000,00'])assert.ok(commands.includes(amount),`Filtered KPI ${amount} appears in the generated PDF`);
  assert.equal(new TextDecoder().decode(new Uint8Array(doc.output('arraybuffer')).slice(0,4)),'%PDF');
 }
 const empty=loadsReportModel({...data,groups:[],summary:{...data.summary,volume:'0',loadCount:0,farmCount:0,averageAtr:''}});
 const result=await createContractTabPdf(contract,empty,brand);assert.equal(result.doc.getNumberOfPages(),1);assert.match(result.doc.internal.pages.flat().join('\n'),/Nenhum carregamento/);
 const long=loadsReportModel({...data,groups:[{...data.groups[0],loads:[{...loads[0],notes:'Texto longo que precisa aparecer integralmente. '.repeat(180)+'FIM-DA-OBSERVACAO'}]}]});
 const longResult=await createContractTabPdf(contract,long,{...brand,orientation:'landscape'});
 assert.match(longResult.doc.internal.pages.flat().join('\n'),/FIM-DA-OBSERVACAO/);
 assert.equal(financialReportModel(contract).title,'Financeiro do contrato');
 const notes=Array.from({length:180},(_,i)=>`OBS-${String(i).padStart(3,'0')} Condições do desconto precisam aparecer integralmente.`).join('\n')+'\nFIM-DO-ACORDO';
 const metrics={loadedVolume:'40',averageAtr:'134',grossAmount:'6431.46',discountAmount:'3000',netAmount:'3431.46',advanceAmount:'1000',receiptAmount:'200',receivedAmount:'1200',pendingAmount:'2231.46',creditAmount:'0',billingPending:false};
 const financialContract={...contract,financialSummary:{months:[{...metrics,month:'2026-09'},{...metrics,month:'2026-10',loadedVolume:'2.5',discountAmount:'0.27'},{...metrics,month:'2026-11',loadedVolume:'0',discountAmount:'0'}],totals:metrics,emptyMonth:metrics,payments:[],discounts:[
  {id:'transport',title:'Acordo Transporte',notes,ratePerTon:'75.123456',months:['2026-09','2026-10','2026-11'],loadedVolume:'987.65',amount:'4567.89',monthlyBreakdown:[{month:'2026-09',loadedVolume:'40',amount:'1234.56'},{month:'2026-10',loadedVolume:'2.5',amount:'0.27'},{month:'2026-11',loadedVolume:'0',amount:'0'}]},
  {id:'service',title:'Acordo Serviço',notes:'OBSERVACAO-SEGUNDO-ACORDO',ratePerTon:'4.5',months:['2026-09'],loadedVolume:'40',amount:'180',monthlyBreakdown:[{month:'2026-09',loadedVolume:'40',amount:'180'}]},
 ]}};
 const financial=financialReportModel(financialContract);
 assert.equal(financial.groups.length,2,'All discounts share a single monthly matrix alongside cash flow');
 assert.equal(financial.widths.reduce((total,width)=>total+width,0),1,'Monthly columns must fit the printable width');
 assert.ok(financial.groups[1].notes.includes('Observação: '+notes));
 assert.deepEqual(financial.groups[1].columns.map(cell=>cell.replace(/\u00a0/g,' ')),['Mês','Toneladas carregadas','Acordo Transporte\nR$ 75,123456/t','Acordo Serviço\nR$ 4,50/t','Total de descontos']);
 assert.deepEqual(financial.groups[1].rows.map(row=>row.map(cell=>cell.replace(/\u00a0/g,' '))),[
  ['Set/2026','40,00 t','R$ 1.234,56','R$ 180,00','R$ 3.000,00'],
  ['Out/2026','2,50 t','R$ 0,27','—','R$ 0,27'],
  ['Nov/2026','0,00 t','R$ 0,00','—','R$ 0,00'],
  ['Geral do contrato','40,00 t','R$ 4.567,89','R$ 180,00','R$ 3.000,00'],
 ],'Matrix pivots by month, distinguishes zero from not applicable and preserves all RPC amounts and totals');
 assert.notEqual(financial.groups[1].columnTones[2],financial.groups[1].columnTones[3],'Adjacent discount columns have different backgrounds');
 assert.equal(financialReportModel({...financialContract,financialSummary:{...financialContract.financialSummary,discounts:[]}}).groups.length,1,'No empty discount matrix is added');
 for(const orientation of ['portrait','landscape']){
  const {doc,fileName}=await createContractTabPdf(financialContract,financial,{...brand,orientation}),commands=doc.internal.pages.flat().join('\n');
  assert.ok(doc.getNumberOfPages()>1);assert.match(fileName,/^financeiro-contrato-/);
  for(const text of ['Movimento financeiro mensal','Acordo Transporte','Acordo Serviço','Toneladas','carregadas','75,123456','1.234,56','0,27','Nov/2026','FIM-DO-ACORDO','OBSERVACAO-SEGUNDO-ACORDO'])assert.ok(commands.includes(text),`PDF includes ${text} in ${orientation}`);
  for(let i=0;i<180;i++)assert.equal(commands.split(`OBS-${String(i).padStart(3,'0')}`).length-1,1,'Long observations must continue across pages exactly once');
  assert.equal(new TextDecoder().decode(new Uint8Array(doc.output('arraybuffer')).slice(0,4)),'%PDF');
 }
 const wideContract={...financialContract,financialSummary:{...financialContract.financialSummary,discounts:Array.from({length:14},(_,i)=>({...financialContract.financialSummary.discounts[0],id:`type-${i}`,title:`Tipo ${i} - ${'Nome de acordo extenso '.repeat(5)}`,notes:`NOTA-TIPO-${String(i).padStart(2,'0')}`,amount:String(5000+i)}))}};
 const wide=financialReportModel(wideContract);
 assert.equal(wide.groups.length,2,'Adding types creates columns, never per-agreement tables');assert.equal(wide.groups[1].columns.length,17);
 for(const orientation of ['portrait','landscape']){
  const {doc}=await createContractTabPdf(wideContract,wide,{...brand,orientation}),commands=doc.internal.pages.flat().join('\n');
  assert.ok(doc.getNumberOfPages()>1,'Wide matrices continue across sheets');
  for(let i=0;i<14;i++){assert.equal(commands.split(`NOTA-TIPO-${String(i).padStart(2,'0')}`).length-1,1,'All notes appear exactly once after the matrix');assert.ok(commands.includes(`5.0${String(i).padStart(2,'0')},00`),'Every type total remains in the PDF');}
 }
 console.log('Passed: load PDF, monthly discount matrix, exact RPC values, zero versus unapplied months, full notes, many columns and portrait/landscape pagination.');
}finally{await rm(directory,{recursive:true,force:true});}
