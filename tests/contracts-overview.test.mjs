import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const temporary=await mkdtemp(join(tmpdir(),'contracts-overview-'));
const bounds={x:14,y:60,width:269,height:125};
const decimal=value=>Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
// jsPDF quantizes RGB channels to its configured numeric precision.
const colorMatches=(actual,expected)=>[1,3,5].every(offset=>Math.abs(parseInt(actual.slice(offset,offset+2),16)-parseInt(expected.slice(offset,offset+2),16))<=3);
const finance={loadedVolume:'412.31',averageAtr:'122.75',grossAmount:'76321.09',grossPerTon:'185.11',discountAmount:'6123.45',netAmount:'70197.64',netPerTon:'170.25',advanceAmount:'3100',receiptAmount:'3200',refundedAmount:'0',receivedAmount:'6300',pendingAmount:'63897.64',creditAmount:'0',refundableAmount:'0',billingPending:false};
const official={...finance,loadedVolume:'9123.45',grossAmount:'876543.21',discountAmount:'123456.78',netAmount:'753086.43',receivedAmount:'34567.89',pendingAmount:'718518.54',averageAtr:'123.4567',pendingContractCount:0};
const contract=index=>({
 id:`contract-${index}`,title:`Contrato ${index+1}`,contractNumber:index%2?'':`CTR-${index+1}`,
 companyId:'company',companyName:'AGRISUL',companyCnpj:'04773159000523',clientId:'same-client',
 clientName:'USINA COM NOME LONGO PARA TESTAR IDENTIFICAÇÃO DOS CONTRATOS LTDA',clientCnpj:'11222333000181',
 typeId:`type-${index%2}`,typeName:index%2?'Fornecimento de cana-de-açúcar':'Parceria agrícola',
 stages:[],status:'Ativo',startDate:'2026-09-01',endDate:'',contractedVolume:'1000',
 atrPriceType:'gross',atrPeriodType:'accumulated',loadedVolume:finance.loadedVolume,remainingVolume:'587.69',
 averageAtr:finance.averageAtr,billingAmount:finance.grossAmount,billingPending:false,
 financialTotals:{...finance},value:'',notes:'',createdAt:'',updatedAt:'',
});
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

// Instrument native jsPDF drawing, not a replacement renderer: invalid geometry must fail
// before the PDF is handed to the browser. Text is checked as a box when unrotated.
function observe(doc){
 const operations=[];
 const point=(x,y,label)=>{
  assert.ok(Number.isFinite(x)&&Number.isFinite(y),`${label}: finite coordinates`);
  assert.ok(x>=bounds.x-.25&&x<=bounds.x+bounds.width+.25,`${label}: x=${x} inside panel`);
  assert.ok(y>=bounds.y-.25&&y<=bounds.y+bounds.height+.25,`${label}: y=${y} inside panel`);
 };
 for(const method of ['rect','roundedRect','line','circle','ellipse','text']){
  const original=doc[method].bind(doc);
  doc[method]=(...args)=>{
   operations.push({method,args:structuredClone(args),fontSize:doc.getFontSize(),textColor:doc.getTextColor(),fillColor:doc.getFillColor()});
   if(method==='text'){
    const [value,x,y,options={}]=args;point(x,y,'text anchor');
    const lines=Array.isArray(value)?value:[value];
    assert.ok(doc.getFontSize()>=5,`Text smaller than 5pt is not readable: ${value}`);
    if(!options.angle&&lines.every(line=>typeof line==='string')){
     const width=Math.max(0,...lines.map(line=>doc.getTextWidth(line)));
     const left=x-(options.align==='right'?width:options.align==='center'?width/2:0);
     const unit=doc.getFontSize()/doc.internal.scaleFactor;
     point(left,y-unit*.8,'text top-left');
     point(left+width,y+(lines.length-1)*unit*(options.lineHeightFactor??doc.getLineHeightFactor()),'text bottom-right');
    }
   }else if(method==='line'){point(args[0],args[1],'line start');point(args[2],args[3],'line end');}
   else if(method==='circle'||method==='ellipse'){
    const [x,y,rx,ry=rx]=args;const radiusY=method==='circle'?rx:ry;
    assert.ok(rx>=0&&radiusY>=0,'Nonnegative radius');point(x-rx,y-radiusY,'ellipse start');point(x+rx,y+radiusY,'ellipse end');
   }else{
    const [x,y,width,height]=args;assert.ok(width>=0&&height>=0,'Nonnegative rectangle dimensions');
    point(x,y,'rectangle start');point(x+width,y+height,'rectangle end');
   }
   return original(...args);
  };
 }
 return operations;
}

try{
 const output=join(temporary,'overview.mjs');
 await build({stdin:{contents:"export {drawContractsOverviewPdf} from './modules/contratos/reporting/contractsOverviewPdf'; export {jsPDF} from './shared/reporting/jsPdfRuntime';",resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm'});
 const {drawContractsOverviewPdf,jsPDF}=await import(pathToFileURL(output));
 async function render(name,input){
  const data=freeze(structuredClone(input)),before=JSON.stringify(data);
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
  const operations=observe(doc);
  await drawContractsOverviewPdf({doc,...bounds},data);
  assert.equal(JSON.stringify(data),before,'Renderer must not mutate official data or contract order');
  assert.equal(doc.getNumberOfPages(),1,'The overview must remain on one landscape page');
  const text=operations.filter(item=>item.method==='text').map(item=>item.args[0]).flat().join('\n');
  const commands=doc.internal.pages.flat().join('\n');
  assert.doesNotMatch(commands,/\b(?:NaN|Infinity|undefined)\b/,'PDF commands must contain no invalid values');
  assert.ok(operations.some(item=>item.method==='rect'||item.method==='roundedRect'),'Use native vector shapes');
  if(process.env.BILLING_SUMMARY_ARTIFACTS){
   await mkdir(process.env.BILLING_SUMMARY_ARTIFACTS,{recursive:true});
   await writeFile(join(process.env.BILLING_SUMMARY_ARTIFACTS,`contracts-overview-${name}.pdf`),new Uint8Array(doc.output('arraybuffer')));
  }
  return {text,operations};
 }
 for(const count of [1,2,20,50,90]){
  const data={contracts:Array.from({length:count},(_,index)=>contract(index)),summary:{...official},total:count};
  const {text,operations}=await render(String(count),data);
  for(const key of ['loadedVolume','grossAmount','discountAmount','netAmount','pendingAmount']){
   assert.ok(text.includes(decimal(official[key])),`Show official ${key}, not a sum of ${count} contract rows`);
  }
  assert.ok(text.includes('C01'),'Contracts with the same client still get distinct category identities');
  if(count>1)assert.ok(text.includes(`C${String(count).padStart(2,'0')}`),'Retain the final category in dense charts');
  for(const color of ['#54a873','#1f7449','#6a929d','#b58235']){
   const shapes=operations.filter(item=>item.method==='rect'&&colorMatches(item.fillColor,color));
   assert.equal(shapes.length,count+1,`Every contract needs its ${color} bar, plus one legend marker, even when labels are sampled`);
  }
 }
 const zero={...finance};for(const key of Object.keys(zero))if(typeof zero[key]==='string')zero[key]='0';
 await render('zero',{contracts:[{...contract(0),loadedVolume:'0',financialTotals:zero}],summary:{...zero,pendingContractCount:0},total:1});
 await render('empty',{contracts:[],summary:{...zero,pendingContractCount:0},total:0});
 const negative={...finance,grossAmount:'123.45',discountAmount:'678.90',netAmount:'-555.45',pendingAmount:'0',creditAmount:'866.56',receivedAmount:'311.11'};
 const signed=await render('negative-credit',{contracts:[{...contract(0),financialTotals:negative}],summary:{...negative,pendingContractCount:0},total:1});
 assert.match(signed.text,/-\s*(?:R\$\s*)?555,45/,'Negative net amount must retain its sign');
 const pendingFinance={...finance,billingPending:true};
 const pending=await render('pending',{contracts:[{...contract(0),financialTotals:pendingFinance,billingPending:true}],summary:{...official,billingPending:true,pendingContractCount:1},total:1});
 for(const key of ['grossAmount','netAmount','pendingAmount'])assert.ok(!pending.text.includes(decimal(official[key])),`Do not display stale ${key} when ATR is pending`);
 for(const key of ['discountAmount','loadedVolume'])assert.ok(pending.text.includes(decimal(official[key])),`Pending ATR must not hide known ${key}`);
 assert.match(pending.text,/ATR|pendente/i,'Unknown financial metrics need an explicit pending explanation');
 for(const color of ['#54a873','#1f7449'])assert.equal(pending.operations.filter(item=>item.method==='rect'&&colorMatches(item.fillColor,color)).length,1,'Pending gross/net have only a legend marker, not a fabricated bar');
 assert.equal(pending.operations.filter(item=>item.method==='rect'&&colorMatches(item.fillColor,'#b58235')).length,2,'Known expenses retain their bar when ATR is pending');
 const absent=await render('missing-finance',{contracts:[{...contract(0),financialTotals:undefined}],summary:{...official},total:1});
 assert.match(absent.text,/n\/d|indisponível|sem dados/i,'Missing financial data must not become a fake zero');
 console.log('Passed: official overview totals, immutable input, adaptive vector geometry, one-page layout and zero/negative/pending/missing states.');
}finally{await rm(temporary,{recursive:true,force:true});}
