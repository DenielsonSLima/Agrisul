import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'agenda-pdf-'));
const outputDirectory='.sites-runtime/agenda-export-validation';
const kinds=['contract','start','end','load','receipt','advance'];
const pageText=(doc,page)=>doc.internal.pages[page].join('\n');
const allText=doc=>doc.internal.pages.slice(1).flat().join('\n');
const occurrences=(text,needle)=>text.split(needle).length-1;

function assertPortraitCalendar(doc,days) {
 assert.ok(Math.abs(doc.internal.pageSize.getWidth()-210)<.1,'PDF must be A4 portrait');
 assert.ok(Math.abs(doc.internal.pageSize.getHeight()-297)<.1);
 for(let day=1;day<=days;day++) {
  const dateText=`(${String(day).padStart(2,'0')}) Tj`;
  const command=doc.internal.pages[1].find(value=>value.includes(dateText));
  assert.ok(command,`Calendar is missing day ${day}`);
  const position=command.match(/[-\d.]+ ([-\d.]+) Td/);
  assert.ok(position,`Calendar day ${day} must have a position`);
  const y=doc.internal.pageSize.getHeight()-Number(position[1])/doc.internal.scaleFactor;
  assert.ok(y<151,`Calendar day ${day} must remain in the upper half of page 1 (y=${y})`);
  for(let page=2;page<=doc.getNumberOfPages();page++) {
   assert.ok(!pageText(doc,page).includes(dateText),'The calendar must not repeat on detail pages');
  }
 }
 assert.ok(pageText(doc,1).includes('(Legenda) Tj'));
}

const monthData=(month,days,firstColumn)=>({month,eventCount:0,days:Array.from({length:days},(_,index)=>({date:`${month}-${String(index+1).padStart(2,'0')}`,dayNumber:index+1,gridColumn:(firstColumn-1+index)%7+1,inMonth:true,isToday:false,eventCount:0,kinds:[],summary:[],events:[]}))});
const event=(day,index,kind='load')=>({id:String(index),date:day.date,kind,title:`Registro ${kind}`,detail:`EVENT_SENTINEL_${String(index).padStart(3,'0')} Fazenda e talhão informados no registro.`,contractId:'contract',contractNumber:`PDF-${String(index).padStart(3,'0')}`,volume:kind==='load'?'1':'',amount:['receipt','advance'].includes(kind)?'1':'',status:'Ativo'});

try {
 const outfile=join(directory,'agenda-pdf.mjs');
 await build({entryPoints:['modules/agenda/reporting/agendaPdf.ts'],outfile,bundle:true,platform:'node',format:'esm'});
 const {createAgendaPdf}=await import(pathToFileURL(outfile).href);
 const brand={company:null,header:{variant:'detailed',logoAlignment:'right',showCnpj:true,showContact:true},watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'test',name:'Teste PDF',email:''},issuedAt:new Date('2026-09-16T12:00:00Z')};
 for(const [month,count,firstColumn] of [['2026-02',28,1],['2028-02',29,3],['2026-09',30,3],['2026-08',31,7]]) {
  const {doc,fileName}=await createAgendaPdf({data:monthData(month,count,firstColumn),companyId:'test',kind:''},brand);
  assert.equal(doc.getNumberOfPages(),1,'Empty months must fit one page, including months with six calendar rows');
  assertPortraitCalendar(doc,count);
  assert.equal(fileName,`agenda-${month}.pdf`);
  assert.ok(pageText(doc,1).includes('0 eventos'));
 }

 await mkdir(outputDirectory,{recursive:true});
 const small=monthData('2026-09',30,3),smallDay=small.days[9];
 small.eventCount=2;smallDay.eventCount=2;smallDay.kinds=['load','receipt'];
 smallDay.summary=[{kind:'load',count:1,volume:'133.50',amount:''},{kind:'receipt',count:1,volume:'',amount:'2456.78'}];
 smallDay.events=[event(smallDay,0),event(smallDay,1,'receipt')];
 const smallSnapshot={data:small,companyId:'test',kind:''};
 const smallBefore=JSON.stringify(smallSnapshot);
 const smallDoc=(await createAgendaPdf(smallSnapshot,brand)).doc;
 assert.equal(JSON.stringify(smallSnapshot),smallBefore,'Export must not modify the cached snapshot');
 assert.equal(smallDoc.getNumberOfPages(),1,'A small agenda must fit its calendar and full event details on the same sheet');
 assertPortraitCalendar(smallDoc,30);
 const smallText=pageText(smallDoc,1);
 assert.ok(smallText.includes('Detalhes do mês'),'Details must start on the first page below the calendar');
 assert.ok(smallText.includes('133,50 t'));assert.ok(smallText.includes('2.456,78'));
 for(let index=0;index<2;index++)assert.equal(occurrences(smallText,`EVENT_SENTINEL_${String(index).padStart(3,'0')}`),1);
 await writeFile(join(outputDirectory,'agenda-portrait-small.pdf'),Buffer.from(smallDoc.output('arraybuffer')));

 const data=monthData('2026-09',30,3),day=data.days[9];
 data.eventCount=123;day.eventCount=123;
 // Deliberately different from the event rows: exported summaries must use
 // the RPC snapshot without calculating replacement totals in the frontend.
 day.summary=[{kind:'load',count:7,volume:'999.01',amount:''}];day.kinds=['load'];
 day.events=Array.from({length:55},(_,index)=>event(day,index));
 day.events[54].detail+=' LONG_BEGIN '+ 'Informações completas da fazenda e talhão. '.repeat(250)+' LONG_END';
 const snapshot={data,companyId:'test',kind:'load'},inputBefore=JSON.stringify(snapshot);
 const {doc,fileName}=await createAgendaPdf(snapshot,brand);
 assert.equal(JSON.stringify(snapshot),inputBefore,'Export must not modify the cached snapshot');
 assert.equal(fileName,'agenda-2026-09-load.pdf');
 assert.ok(doc.getNumberOfPages()>3,'Long event details must continue onto as many pages as needed');
 assertPortraitCalendar(doc,30);
 const text=allText(doc);
 assert.equal(occurrences(text,'999,01 t'),1,'The complete daily volume belongs in the detail section exactly once');
 assert.ok(text.includes('123 eventos'));assert.ok(text.includes('7 carregamentos'));
 assert.ok(pageText(doc,1).includes('EVENT_SENTINEL_000'),'Available space below the calendar must contain actual event details');
 for(let index=0;index<55;index++) {
  const suffix=String(index).padStart(3,'0');
  assert.ok(text.includes(`PDF-${suffix}`),`Missing contract metadata for event ${index}`);
  assert.equal(occurrences(text,`EVENT_SENTINEL_${suffix}`),1,`Event ${index} must be exported exactly once`);
 }
 assert.equal(occurrences(text,'LONG_BEGIN'),1);assert.equal(occurrences(text,'LONG_END'),1);
 assert.ok(text.indexOf('LONG_END')>text.indexOf('LONG_BEGIN'),'Wrapped details must retain their original order');
 for(let page=2;page<=doc.getNumberOfPages();page++) {
  const continuation=pageText(doc,page);
  assert.ok(continuation.includes('10/09/2026'),'Detail continuation must identify its day');
 }
 for(const command of doc.internal.pages.slice(1).flat().filter(value=>value.includes('EVENT_SENTINEL_')||value.includes('LONG_END'))) {
  const font=command.match(/\/F\d+ ([\d.]+) Tf/);
  assert.ok(font&&Number(font[1])>=8,'Event details must stay readable rather than shrink to force one page');
 }
 await writeFile(join(outputDirectory,'agenda-portrait-busy.pdf'),Buffer.from(doc.output('arraybuffer')));

 const crowded=monthData('2026-08',31,7);
 crowded.eventCount=186;
 for(const [index,entry] of crowded.days.entries()) {
  entry.eventCount=6;entry.kinds=[...kinds];
  entry.summary=kinds.map(kind=>({kind,count:99,amount:['receipt','advance'].includes(kind)?'12345.67':'',volume:kind==='load'?'123.45':''}));
  entry.events=kinds.map((kind,kindIndex)=>event(entry,index*6+kindIndex,kind));
 }
 const company={id:'test',name:'Empresa de Teste',legalName:'Empresa de Teste',cnpj:'12345678000190',phone:'(11) 99999-9999',email:'teste@example.com',street:'Rua Teste',number:'123',complement:'Sala 1',district:'Centro',city:'São Paulo',state:'SP',zipCode:'01000000',logoUrl:null};
 const crowdedDoc=(await createAgendaPdf({data:crowded,companyId:'test',kind:''},{...brand,company})).doc;
 assertPortraitCalendar(crowdedDoc,31);
 assert.ok(crowdedDoc.getNumberOfPages()>1,'Crowded months must paginate instead of dropping details');
 const crowdedText=allText(crowdedDoc);
 assert.equal(occurrences(crowdedText,'12.345,67'),62,'All receipt and advance totals must remain visible');
 assert.equal(occurrences(crowdedText,'123,45 t'),31,'Every daily volume must remain visible');
 assert.equal(occurrences(crowdedText,'99 contratos cadastrados'),31);
 assert.equal(occurrences(crowdedText,'99 carregamentos'),31);
 for(let index=0;index<186;index++)assert.equal(occurrences(crowdedText,`EVENT_SENTINEL_${String(index).padStart(3,'0')}`),1);
 await writeFile(join(outputDirectory,'agenda-portrait-crowded.pdf'),Buffer.from(crowdedDoc.output('arraybuffer')));
 console.log('PASS: A4 portrait, half-page 28/29/30/31-day calendars, six weeks, small agendas on one sheet, natural pagination, readable complete event details, immutable server summaries and filters.');
} finally {
 if(!resolve(directory).startsWith(join(resolve(tmpdir()),'agenda-pdf-')))throw Error('Unsafe test cleanup path');
 await rm(directory,{recursive:true,force:true});
}
