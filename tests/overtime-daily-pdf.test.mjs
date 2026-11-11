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
 console.log('Passed: individual daily PDF, real calendar dates, explicit intervals, exact server totals, legacy/adjustment disclosure and complete pagination.');
}finally{await rm(directory,{recursive:true,force:true});}
