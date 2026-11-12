import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'overtime-daily-pdf-'));
try{
 const outfile=join(directory,'pdf.mjs'),presentationFile=join(directory,'presentation.mjs');
 await Promise.all([
  build({entryPoints:['modules/solicitacoes/horas-extras/reporting/dailyOvertimePdf.ts'],outfile,bundle:true,platform:'node',format:'esm'}),
  build({entryPoints:['modules/solicitacoes/horas-extras/reporting/dailyOvertimePresentation.ts'],outfile:presentationFile,bundle:true,platform:'node',format:'esm'}),
 ]);
 const {createDailyOvertimePdf}=await import(pathToFileURL(outfile));
 const {dailyOvertimeCalendar,dailyClockLabel,dailyReasonLabel}=await import(pathToFileURL(presentationFile));
 const dates=dailyOvertimeCalendar('2026-09-26','2026-10-25',[]).map(item=>item.date);
 assert.equal(dates.length,30);assert.equal(dates[0],'2026-09-26');assert.equal(dates.at(-1),'2026-10-25');
 assert.ok(!dates.includes('2026-09-31'),'Calendar does not repeat invalid dates from spreadsheet formatting');
 assert.equal(dailyOvertimeCalendar('2028-02-28','2028-03-01',[]).length,3,'Leap days remain visible');
 assert.deepEqual(dailyOvertimeCalendar('2026-11-25','2026-11-01',[]),[]);
 assert.equal(dailyClockLabel('06:05:00'),'06:05');assert.equal(dailyClockLabel('06:05:32'),'06:05:32');
 const entry={date:'2026-10-27',startTime:'06:05:00',breakStart:'',breakEnd:'',endTime:'18:05:00',breakDuration:'02:00:00',rate:'100',reason:'PLANTAO MOAGEM',approval:'JOSE',hours50:'00:00:00',hours100:'10:00:00'};
 assert.equal(dailyReasonLabel(entry),'PLANTAO MOAGEM\nIntervalo descontado: 02:00');
 assert.equal(dailyReasonLabel({...entry,breakStart:'12:00:00',breakEnd:'14:00:00'}),'PLANTAO MOAGEM','Explicit interval clocks already show the interval');
 assert.equal(dailyReasonLabel({...entry,breakDuration:'00:00:00'}),'PLANTAO MOAGEM');
 const brand={company:null,header:{variant:'compact',logoAlignment:'left',showCnpj:false,showContact:false},watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'tester',name:'Teste',email:''},issuedAt:new Date('2026-11-11T12:00:00Z')};
 const row={employeeId:'employee',employeeName:'LUCAS SANTOS SILVA',registrationNumber:'3057',jobTitle:'MOTORISTA',hours50:'121:22:33',hours100:'40:11:12',source:'daily',daily:{employeeId:'employee',activity:'MOAGEM',sector:'AGRICOLA',entries:[entry],adjustment:null,calculated50:'121:22:33',calculated100:'40:11:12',total50:'121:22:33',total100:'40:11:12',hasDailyEntries:true,legacyHours50:'00:00:00',legacyHours100:'00:00:00'}};
 const report={id:'report',companyId:'company',dateFrom:'2026-10-26',dateTo:'2026-11-25',referenceMonth:'2026-11',sector:'AGRICOLA',employeeCount:1,total50:row.hours50,total100:row.hours100,createdAt:'',updatedAt:'',notes:'',status:'open',finishedAt:null,canFinish:true,rows:[row]};
 const before=JSON.stringify({report,row}),result=await createDailyOvertimePdf(report,row,brand);
 assert.equal(JSON.stringify({report,row}),before,'Export never mutates the saved snapshot');
 assert.equal(result.doc.getNumberOfPages(),1,'A 31-day period fits portrait A4');
 assert.ok(Math.abs(result.doc.internal.pageSize.getWidth()-210)<.1);assert.ok(Math.abs(result.doc.internal.pageSize.getHeight()-297)<.1);
 const text=result.doc.internal.pages.slice(1).flat().join('\n');
 for(const marker of ['INFORMATIVO DE HORAS EXTRAS','26/10/2026','25/11/2026','LUCAS SANTOS SILVA','3057','MOAGEM','AGRICOLA','50%','100%','06:05','18:05','10:00:00','121:22:33','40:11:12','PLANTAO MOAGEM','JOSE','Intervalo descontado:'])assert.ok(text.includes(marker),marker);
 assert.equal(result.fileName,'Horas extras - LUCAS SANTOS SILVA - 26-10-2026 a 25-11-2026.pdf');
 assert.equal(text.split('(121:22:33) Tj').length-1,1,'Print the exact server total once without recalculating from the daily times');
 const mixedEntries=[
  {...entry,id:'10000000-0000-4000-8000-000000000001',startTime:'06:00:00',endTime:'09:45:12',breakDuration:'00:00:00',rate:'50',hours50:'03:45:12',hours100:'00:00:00',reason:'PERIODO50',approval:'C50'},
  {...entry,id:'10000000-0000-4000-8000-000000000002',startTime:'09:45:12',endTime:'11:00:00',breakDuration:'00:00:00',rate:'100',hours50:'00:00:00',hours100:'01:14:48',reason:'PERIODO100',approval:'C100'},
 ];
 const mixedCalendar=dailyOvertimeCalendar(report.dateFrom,report.dateTo,mixedEntries);
 assert.equal(mixedCalendar.length,32,'Keep every calendar date and an extra row for the second period');
 assert.deepEqual(mixedCalendar.filter(item=>item.date===entry.date).map(item=>item.entry.id),mixedEntries.map(item=>item.id),'Both periods on the same date remain in RPC order');
 assert.equal(mixedCalendar.filter(item=>!item.entry).length,30,'Dates without entries retain one blank line each');
 assert.equal(new Set(mixedCalendar.map(item=>item.rowKey)).size,mixedCalendar.length,'Document preview rows have unique period keys');
 const mixedRow={...row,daily:{...row.daily,entries:mixedEntries}},mixedBefore=JSON.stringify(mixedRow);
 const mixedDoc=(await createDailyOvertimePdf(report,mixedRow,brand)).doc,mixedCommands=mixedDoc.internal.pages.slice(1).flat(),mixedText=mixedCommands.join('\n');
 assert.equal(JSON.stringify(mixedRow),mixedBefore,'Same-date export preserves the server snapshot');
 for(const marker of ['PERIODO50','PERIODO100','C50','C100','03:45:12','01:14:48'])assert.equal(mixedText.split('('+marker+') Tj').length-1,1,'Print every saved period value exactly once: '+marker);
 const printedX=value=>Number(mixedCommands.find(command=>command.includes('('+value+') Tj')).match(/([\d.-]+) ([\d.-]+) Td/)[1]);
 assert.ok(printedX('03:45:12')<printedX('01:14:48'),'50% and 100% stay in their separate model columns on same-date rows');
 assert.equal(mixedText.split('(121:22:33) Tj').length-1,1,'Keep the exact server summary even when it differs from period totals');
 const manyPeriods=Array.from({length:7},(_,day)=>Array.from({length:8},(_,period)=>{
  const date=new Date('2026-10-26T12:00:00Z');date.setUTCDate(date.getUTCDate()+day);
  return {...entry,id:`20000000-0000-4000-8000-${String(day*8+period+1).padStart(12,'0')}`,date:date.toISOString().slice(0,10),startTime:String(period).padStart(2,'0')+':00:00',endTime:String(period+1).padStart(2,'0')+':00:00',breakDuration:'00:00:00',rate:period%2?'100':'50',hours50:period%2?'00:00:00':'01:00:00',hours100:period%2?'01:00:00':'00:00:00',reason:`DIA${day}PERIODO${period}`,approval:''};
 })).flat();
 const multiplePages=(await createDailyOvertimePdf(report,{...row,daily:{...row.daily,entries:manyPeriods}},brand)).doc,multiplePageTexts=multiplePages.internal.pages.slice(1).map(page=>page.join('\n')),allPeriodsText=multiplePageTexts.join('\n');
 assert.ok(multiplePages.getNumberOfPages()>1,'Several periods per date paginate the complete calendar');
 for(const savedPeriod of manyPeriods)assert.equal(allPeriodsText.split('('+savedPeriod.reason+') Tj').length-1,1,'No period dropped or repeated across pages: '+savedPeriod.reason);
 for(const page of multiplePageTexts)assert.ok(page.includes('LUCAS SANTOS SILVA'),'Every period page repeats the employee header');
 assert.equal(multiplePageTexts.filter(page=>page.includes('(121:22:33) Tj')).length,1,'Server summary occurs once on the final period page');
 assert.ok(multiplePageTexts.at(-1).includes('(121:22:33) Tj'));
 const longName='MARIA DE LOURDES OLIVEIRA '.repeat(6).trim(),longRegistration='3057'.repeat(15);
 assert.ok(longName.length<=160&&longRegistration.length===60,'Use employee values accepted by the RPC');
 const headerRow={...row,employeeName:longName,registrationNumber:longRegistration,daily:{...row.daily,activity:'ATIVIDADE DE OPERACAO '.repeat(9).trim(),sector:'SETOR AGRICOLA '.repeat(8).trim()}};
 const headerDoc=(await createDailyOvertimePdf(report,headerRow,brand)).doc;
 // Inspect the emitted PDF primitives rather than repeating the wrapping algorithm.
 // Measure each actual text line with its emitted font and compare it to its drawn frame.
 const page=headerDoc.internal.pages[1],scale=headerDoc.internal.scaleFactor;
 for(const [prefix,expected] of [
  ['FUNCIONÁRIO:','FUNCIONÁRIO: '+longName+'    MATRÍCULA: '+longRegistration],
  ['ATIVIDADE:','ATIVIDADE: '+headerRow.daily.activity+'    SETOR: '+headerRow.daily.sector],
 ]){
  const index=page.findIndex(command=>command.startsWith('BT\n')&&command.includes('('+prefix));
  assert.ok(index>=0,'Header text is emitted: '+prefix);
  const command=page[index],rectangle=page.slice(0,index).reverse().find(command=>command.trim().endsWith(' re'));
  const frame=rectangle?.match(/^([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re$/);
  const origin=command.match(/([\d.-]+) ([\d.-]+) Td/),font=command.match(/\/(F\d+) ([\d.]+) Tf/),leading=command.match(/([\d.]+) TL/);
  assert.ok(frame&&origin&&font&&leading,'Drawn frame, text origin and font are inspectable');
  assert.equal(font[1],headerDoc.internal.getFont('times','bold').id,'Long metadata keeps the model\'s bold font');
  headerDoc.setFont('times','bold');headerDoc.setFontSize(Number(font[2]));
  const lines=[...command.matchAll(/\(([^()]*)\) Tj/g)].map(match=>match[1]);
  assert.ok(lines.length>1,'Long metadata actually wraps');
  assert.equal(lines.join(' ').replace(/\s+/g,' ').trim(),expected.replace(/\s+/g,' ').trim(),'Wrapping preserves every header character');
  const left=Number(frame[1])/scale,right=(Number(frame[1])+Number(frame[3]))/scale,x=Number(origin[1])/scale;
  for(const [lineIndex,line] of lines.entries()){
   assert.ok(x>=left,'Header starts inside its frame');
   assert.ok(x+headerDoc.getTextWidth(line)<=right+.01,'Printed bold line stays inside the right border: '+prefix+' '+line);
   const baseline=Number(origin[2])-lineIndex*Number(leading[1]);
   assert.ok(baseline<=Number(frame[2])&&baseline>=Number(frame[2])+Number(frame[4]),'Every wrapped baseline stays inside the vertically resized frame');
  }
 }
 const headerText=headerDoc.internal.pages.slice(1).flat().join('\n');
 for(const total of [row.hours50,row.hours100])assert.ok(headerText.includes('('+total+') Tj'),'Long headers preserve exact server totals');
 const adjusted={...row,daily:{...row.daily,adjustment:{hours50:'02:30:00',hours100:'01:00:00',reason:'CORRECAO AUTORIZADA'}}};
 const adjustmentText=(await createDailyOvertimePdf(report,adjusted,brand)).doc.internal.pages.slice(1).flat().join('\n');
 for(const marker of ['AJUSTE DO RESUMO','02:30:00','01:00:00','CORRECAO AUTORIZADA'])assert.ok(adjustmentText.includes(marker),marker);
 const legacy={...row,source:'legacy',daily:{...row.daily,entries:[],hasDailyEntries:false}};
 const legacyText=(await createDailyOvertimePdf(report,legacy,brand)).doc.internal.pages.slice(1).flat().join('\n');
 assert.ok(legacyText.includes('Resumo anterior preservado.'));assert.ok(legacyText.includes('121:22:33'));
 const longRow={...row,daily:{...row.daily,entries:[{...entry,reason:Array.from({length:500},(_,index)=>'MOTIVO'+index).join(' ')}]}};
 const long=(await createDailyOvertimePdf(report,longRow,brand)).doc,pages=long.internal.pages.slice(1).map(page=>page.join('\n'));
 assert.ok(long.getNumberOfPages()>1,'Long reasons continue on additional pages');
 assert.ok(pages.join('\n').includes('MOTIVO499'),'No final reason lines dropped');
 for(const page of pages){assert.ok(page.includes('LUCAS SANTOS SILVA'));assert.ok(page.includes('26/10/2026'));}
 assert.equal(pages.filter(page=>page.includes('121:22:33')).length,1,'Final totals occur once on the last page');
 console.log('Passed: individual daily PDF, both rates and every period on the same date, complete calendar and period pagination, long bold headers inside drawn frames, explicit intervals, exact server totals and legacy/adjustment disclosure.');
}finally{await rm(directory,{recursive:true,force:true});}
