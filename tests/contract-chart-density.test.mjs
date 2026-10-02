import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'contract-chart-density-'));
try{
 const output=join(directory,'charts.mjs');
 await build({stdin:{contents:`export * from './modules/contratos/reporting/contractSummaryPdfCharts'; export * from './modules/contratos/reporting/contractSummaryFarmPdfChart'; export {jsPDF} from './shared/reporting/jsPdfRuntime'; export {contractDailyLoadGranularityCopy} from './modules/contratos/utils/contractDailyLoadsPresentation';`,resolveDir:process.cwd()},outfile:output,bundle:true,platform:'node',format:'esm'});
 const {drawContractLoadPdfChart,drawContractFinancialPdfChart,drawContractFarmPdfChart,jsPDF,contractDailyLoadGranularityCopy}=await import(pathToFileURL(output));
 const copy=contractDailyLoadGranularityCopy.day;
 const format=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
 const rowsFor=count=>Array.from({length:count},(_,index)=>{
  const date=new Date(Date.UTC(2026,8,1+index)).toISOString().slice(0,10);
  return {key:date,date,endDate:date,label:date.slice(8)+'/'+date.slice(5,7),volume:100+index,volumeText:String(100+index),loadCount:1,averageAtr:120+index/100,averageAtrText:String(120+index/100),gross:10000+index*123.45,net:7000+index*12.34,billingPending:false};
 });
 function observe(doc){
  const drawing={shapes:[],texts:[],lines:[],circles:[]};let fill=[];
  const setFill=doc.setFillColor;doc.setFillColor=function(...args){fill=args;return setFill.apply(this,args);};
  for(const method of ['rect','roundedRect']){
   const original=doc[method];doc[method]=function(...args){drawing.shapes.push({method,args:[...args],fill:[...fill]});return original.apply(this,args);};
  }
  const text=doc.text;doc.text=function(value,x,y,options){drawing.texts.push({value:Array.isArray(value)?value.join(' '):value,x,y,options,width:Math.max(...(Array.isArray(value)?value:[value]).map(line=>doc.getTextWidth(line))),fontSize:doc.getFontSize()});return text.apply(this,arguments);};
  const line=doc.line;doc.line=function(...args){drawing.lines.push(args);return line.apply(this,args);};
  const circle=doc.circle;doc.circle=function(...args){drawing.circles.push(args);return circle.apply(this,args);};
  return drawing;
 }
 function assertDrawingBounds(drawing,ctx){
  for(const {args:[x,y,w,h]} of drawing.shapes){
   assert.ok([x,y,w,h].every(Number.isFinite),'Every rectangle must have finite geometry');
   assert.ok(w>=0&&h>=0,'Missing/negative values must not create negative rectangle geometry');
   assert.ok(x>=ctx.x-.1&&x+w<=ctx.x+ctx.width+.1,'Rectangle must stay inside chart width');
   assert.ok(y>=ctx.y-.1&&y+h<=ctx.y+ctx.height+.1,'Rectangle must stay inside chart height');
  }
  for(const {x,y,width,fontSize,options} of drawing.texts){
   assert.ok(Number.isFinite(x)&&Number.isFinite(y),'Text coordinates must remain finite');
   assert.ok(y>=ctx.y&&y<=ctx.y+ctx.height,'Text baseline must stay inside its chart');
   if(options?.angle===90){
    // jsPDF applies horizontal alignment before rotation. Centering therefore
    // shifts the x anchor by half the unrotated width, misaligning long labels.
    const actualX=x-(options.align==='center'?width/2:0),top=y-width;
    const bands=drawing.shapes.filter(shape=>shape.method==='rect'&&shape.args[2]>50);
    assert.ok(bands.some(({args:[left,bandTop,bandWidth,bandHeight]})=>actualX-fontSize*.3528>=left-.5&&actualX<=left+bandWidth+.5&&top>=bandTop-.5&&y<=bandTop+bandHeight+.5),'Rotated labels must remain inside their own value band, not overlap bars or adjacent rows');
   }
  }
 }
 function assertVisibleValues(drawing,rows,financial=false){
  const texts=drawing.texts.map(text=>String(text.value));
  const sampled=texts.some(text=>text.includes('rótulos a cada'));
  const visibleRows=rows.filter(row=>texts.includes(row.label));
  assert.ok(texts.includes(rows[0].label)&&texts.includes(rows.at(-1).label),'The first and last periods must always remain visible');
  if(!sampled)assert.equal(visibleRows.length,rows.length,'Every period must have a label when there is no sampling notice');
  else{
   assert.ok(texts.some(text=>text.includes(`Todos os ${rows.length} períodos`)),'Sampling must disclose the complete bucket count');
   assert.ok(visibleRows.length>=2&&visibleRows.length<rows.length,'Dense labels must be sampled without losing the range endpoints');
  }
  if(financial)for(const row of visibleRows){
   assert.ok(texts.some(text=>text.includes(format.format(row.gross))),`Financial chart lost exact gross for visible date ${row.label}`);
   assert.ok(texts.some(text=>text.includes(format.format(row.net))),`Financial chart lost exact net for visible date ${row.label}`);
  }
 }
 for(const orientation of ['landscape','portrait'])for(const count of [1,11,31,90,365]){
  const rows=rowsFor(count),snapshot=JSON.stringify(rows),doc=new jsPDF({orientation,unit:'mm',format:'a4'});
  const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight();
  const ctx={doc,x:14,y:50,width:width-28,height:height-74};
  const operation=observe(doc);
  drawContractLoadPdfChart(ctx,rows,copy,'01/09/2026 a '+rows.at(-1).date,'Média diária 100,00 t · Volume 1.100,00 t · ATR médio 120,00 kg/t');
  assert.equal(doc.getNumberOfPages(),1,'The complete operational chart must fit a single page');
  assertDrawingBounds(operation,ctx);
  const quantityBars=operation.shapes.filter(shape=>shape.fill.join(',')==='84,168,115'&&shape.args[3]>3&&shape.args[0]>ctx.x+20);
  assert.equal(quantityBars.length,count,`${orientation}: retain every one of ${count} operational buckets`);
  assertVisibleValues(operation,rows);
  assert.ok(operation.texts.some(text=>text.value==='Volume (t)'),'Operational chart retains the volume row');
  doc.addPage();const finance=observe(doc);
  drawContractFinancialPdfChart(ctx,rows,copy,'Período sintético','ATR Bruto · Acumulado');
  assert.equal(doc.getNumberOfPages(),2,'The complete financial chart must fit one additional page');
  assertDrawingBounds(finance,ctx);
  const grossBars=finance.shapes.filter(shape=>shape.fill.join(',')==='84,168,115'&&shape.args[3]>3&&shape.args[0]>ctx.x+20);
  const netBars=finance.shapes.filter(shape=>shape.fill.join(',')==='31,116,73'&&shape.args[3]>3);
  assert.equal(grossBars.length,count,`${orientation}: retain every one of ${count} financial buckets`);
  assert.equal(netBars.length,count,'Each nonzero net amount needs its own internal fill');
  grossBars.forEach((bar,index)=>{
   assert.equal(bar.args[0],netBars[index].args[0],'Gross and net must share horizontal position');
   assert.equal(bar.args[2],netBars[index].args[2],'Gross and net must share width');
   assert.ok(bar.args[2]<=8.5+.01,'Financial columns must follow the narrow operational width cap');
  });
  assertVisibleValues(finance,rows,true);
  assert.ok(!finance.texts.some(text=>text.value==='Volume (t)'),'Financial chart must not repeat the operational volume row');
  assert.equal(JSON.stringify(rows),snapshot,'Rendering must not mutate authoritative data');
  if(process.env.BILLING_SUMMARY_ARTIFACTS){
   const folder=resolve(process.env.BILLING_SUMMARY_ARTIFACTS);await mkdir(folder,{recursive:true});
   await writeFile(join(folder,`chart-density-${orientation}-${count}.pdf`),new Uint8Array(doc.output('arraybuffer')));
  }
 }
 for(const state of ['constant','missing','zero','pending','negative']){
  const rows=rowsFor(3).map(row=>({...row,averageAtr:state==='missing'?null:120,averageAtrText:state==='missing'?'':'120',gross:state==='pending'?null:state==='zero'?0:row.gross,net:state==='pending'?null:state==='zero'?0:state==='negative'?-123.45:row.net,billingPending:state==='pending'}));
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'}),ctx={doc,x:14,y:50,width:269,height:136};
  const operation=observe(doc);drawContractLoadPdfChart(ctx,rows,copy,'Período sintético','');assertDrawingBounds(operation,ctx);
  assert.equal(operation.circles.length,state==='missing'?0:rows.length,'Missing ATR must not invent plotted points');
  if(state==='constant')assert.equal(new Set(operation.circles.map(circle=>circle[1])).size,1,'Constant ATR must form a horizontal line');
  doc.addPage();const finance=observe(doc);drawContractFinancialPdfChart(ctx,rows,copy,'Período sintético','ATR Bruto · Acumulado');assertDrawingBounds(finance,ctx);
  const text=finance.texts.map(entry=>entry.value).join(' ');
  if(state==='pending')assert.match(text,/Pendente|pendente/,'Unknown values must retain an explicit pending state');
  if(state==='zero')assert.match(text,/0,00/,'Zero must be represented explicitly');
  if(state==='negative')assert.match(text,/-123,45/,'A negative net must remain signed, not become zero or positive');
 }
 for(const [granularity,periodLabel] of [['week','28/09–04/10'],['fortnight','1ª quinz. Set/2026'],['month','Set/2026']]){
  const rows=rowsFor(31).map(row=>({...row,label:periodLabel}));
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'}),ctx={doc,x:14,y:50,width:269,height:136};
  const operation=observe(doc);drawContractLoadPdfChart(ctx,rows,contractDailyLoadGranularityCopy[granularity],'Período sintético','');assertDrawingBounds(operation,ctx);
  assert.equal(operation.texts.filter(text=>text.value===periodLabel).length,31,'Long period labels must remain visible in every slot');
  doc.addPage();const finance=observe(doc);drawContractFinancialPdfChart(ctx,rows,contractDailyLoadGranularityCopy[granularity],'Período sintético','ATR Bruto · Acumulado');assertDrawingBounds(finance,ctx);
  assert.equal(finance.texts.filter(text=>text.value===periodLabel).length,31,'Financial label rotation must preserve long periods');
  if(process.env.BILLING_SUMMARY_ARTIFACTS){
   const folder=resolve(process.env.BILLING_SUMMARY_ARTIFACTS);await mkdir(folder,{recursive:true});
   await writeFile(join(folder,`chart-density-${granularity}-31.pdf`),new Uint8Array(doc.output('arraybuffer')));
  }
 }
 for(const orientation of ['landscape','portrait'])for(const count of [1,3,20,50]){
  const farms=Array.from({length:count},(_,index)=>({id:'farm-'+index,name:`Fazenda ${String(index+1).padStart(2,'0')}`,loadCount:1,volume:String(100+index),grossAmount:String(25000+index*123.45),netAmount:String(20000+index*12.34),billingPending:false}));
  const snapshot=JSON.stringify(farms),doc=new jsPDF({orientation,unit:'mm',format:'a4'});
  const ctx={doc,x:14,y:50,width:doc.internal.pageSize.getWidth()-28,height:doc.internal.pageSize.getHeight()-74};
  const drawing=observe(doc);drawContractFarmPdfChart(ctx,farms,'01/09/2026 a 30/09/2026');
  assert.equal(doc.getNumberOfPages(),1,'All farm results must occupy one dedicated page');
  assertDrawingBounds(drawing,ctx);
  const texts=drawing.texts.map(text=>String(text.value));
  for(const farm of farms){
   assert.ok(texts.includes(farm.name),`${orientation}: ${count} farms must retain each farm identity, lost ${farm.name}`);
   assert.ok(texts.includes(format.format(Number(farm.grossAmount))),`Farm chart lost exact gross for ${farm.name}`);
   assert.ok(texts.includes(format.format(Number(farm.netAmount))),`Farm chart lost exact net for ${farm.name}`);
  }
  for(const color of ['108,151,112','84,168,115','31,116,73'])assert.equal(drawing.shapes.filter(shape=>shape.method==='rect'&&shape.fill.join(',')===color).length,count,'Retain quantity, gross and net bars for every farm');
  assert.equal(JSON.stringify(farms),snapshot,'The farm chart must not mutate official RPC totals');
  if(process.env.BILLING_SUMMARY_ARTIFACTS){
   const folder=resolve(process.env.BILLING_SUMMARY_ARTIFACTS);await mkdir(folder,{recursive:true});
   await writeFile(join(folder,`farm-density-${orientation}-${count}.pdf`),new Uint8Array(doc.output('arraybuffer')));
  }
 }
 {
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'}),ctx={doc,x:14,y:50,width:269,height:136};
  const rows=[
   {id:'long',name:'Fazenda Santa Maria das Palmeiras e das Nascentes do Rio Comprido',loadCount:1,volume:'120',grossAmount:'23000.12',netAmount:'17000.91',billingPending:false},
   {id:'pending',name:'Fazenda pendente',loadCount:1,volume:'80',grossAmount:'',netAmount:'',billingPending:true},
   {id:'negative',name:'Fazenda negativa',loadCount:1,volume:'10',grossAmount:'100.00',netAmount:'-123.45',billingPending:false},
   {id:'zero',name:'Fazenda zero',loadCount:1,volume:'0',grossAmount:'0',netAmount:'0',billingPending:false},
  ];
  const drawing=observe(doc);drawContractFarmPdfChart(ctx,rows,'Período sintético');assertDrawingBounds(drawing,ctx);
  const text=drawing.texts.map(entry=>entry.value).join(' ');
  for(const expected of ['Fazenda Santa Maria','Rio Comprido','Pendente','-123,45','0,00'])assert.ok(text.includes(expected),'Farm page lost long name or edge state '+expected);
  for(const row of rows){
   const single=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
   const singleDrawing=observe(single);
   drawContractFarmPdfChart({...ctx,doc:single},[row],'Período sintético');
   assertDrawingBounds(singleDrawing,ctx);
   const singleText=singleDrawing.texts.map(entry=>entry.value).join(' ');
   assert.ok(singleText.includes(row.name),'Single-farm highlight must retain long farm names');
   assert.ok(singleText.includes(row.billingPending?'Pendente':format.format(Number(row.netAmount))),'Single-farm highlight must preserve pending, negative and zero amounts');
  }
 }
 console.log('Passed: daily density through365, dedicated pages, farm density through50, exact displayed values, explicit daily-label sampling, shared bar geometry, bounds and edge states.');
}finally{await rm(directory,{recursive:true,force:true});}
