import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]}));
const directory=await mkdtemp(join(tmpdir(),'overtime-pdf-'));
try{
 const outfile=join(directory,'pdf.mjs');
 await build({entryPoints:['modules/solicitacoes/horas-extras/reporting/overtimePdf.ts'],outfile,bundle:true,platform:'node',format:'esm'});
 const {createOvertimePdf}=await import(pathToFileURL(outfile));
 const brand={company:null,header:{variant:'compact',logoAlignment:'left',showCnpj:false,showContact:false},watermark:{imageUrl:null,opacity:15,size:60},issuer:{id:'tester',name:'Teste',email:''},issuedAt:new Date('2026-10-30T12:00:00Z')};
 const report={id:'test',companyId:'company',dateFrom:'2026-09-26',dateTo:'2026-10-25',referenceMonth:'2026-09',sector:'AGRICOLA',employeeCount:17,total50:'590:22:00',total100:'384:00:00',createdAt:'',updatedAt:'',rows:Array.from({length:17},(_,index)=>({employeeId:'id-'+index,employeeName:'FUNCIONARIO_SENTINEL_'+index,registrationNumber:'00'+index,jobTitle:'MOTORISTA',hours50:index===0?'21:22:00':'48:00:00',hours100:'30:00:00'}))};
 const before=JSON.stringify(report),result=await createOvertimePdf(report,brand);
 assert.equal(JSON.stringify(report),before,'PDF uses the saved server projection without modifying inputs');
 assert.equal(result.doc.getNumberOfPages(),1,'The reference model fits one portrait page');
 assert.ok(Math.abs(result.doc.internal.pageSize.getWidth()-210)<.1,'PDF uses A4 portrait width');
 assert.ok(Math.abs(result.doc.internal.pageSize.getHeight()-297)<.1,'PDF uses A4 portrait height');
 const text=result.doc.internal.pages.slice(1).flat().join('\n');
 for(const marker of ['26/09/2026','25/10/2026','09/2026','AGRICOLA','50%','100%','590:22:00','384:00:00','COORD. DO SETOR','DIRETOR DA UNIDADE'])assert.ok(text.includes(marker),marker);
 assert.equal(result.fileName,'Relatório de horas extras - 26-09-2026 a 25-10-2026.pdf');
 const unordered={...report,employeeCount:4,rows:[
  {...report.rows[0],employeeName:'ZULEICA',hours50:'',hours100:'   '},
  {...report.rows[1],employeeName:'ÉRICA',hours50:'00:00:00',hours100:'01:02:03'},
  {...report.rows[2],employeeName:'DAMIÃO',hours50:'02:03:04',hours100:''},
  {...report.rows[3],employeeName:'ANA',hours50:'',hours100:'00:00:00'},
 ]};
 const unorderedBefore=JSON.stringify(unordered),ordered=await createOvertimePdf(unordered,brand);
 const orderedText=ordered.doc.internal.pages.slice(1).flat().join('\n');
 const names=['ANA','DAMIÃO','ÉRICA','ZULEICA'];
 for(let index=1;index<names.length;index++)assert.ok(orderedText.indexOf('('+names[index-1]+') Tj')<orderedText.indexOf('('+names[index]+') Tj'),'Employees use Portuguese alphabetical order, including accented names');
 assert.equal(JSON.stringify(unordered),unorderedBefore,'Alphabetizing the PDF preserves the saved row order');
 assert.equal(orderedText.split('(00:00:00) Tj').length-1,6,'Empty and zero hours print as zero only on employee rows, leaving filler rows blank');
 for(const duration of ['01:02:03','02:03:04','590:22:00','384:00:00'])assert.ok(orderedText.includes('('+duration+') Tj'),'Entered hours and server totals remain unchanged');
 const large={...report,rows:Array.from({length:60},(_,index)=>({...report.rows[0],employeeId:'large-'+index,employeeName:'UNIQUE_EMPLOYEE_'+index}))};
 const {doc}=await createOvertimePdf(large,brand),pages=doc.internal.pages.slice(1).map(page=>page.join('\n'));
 assert.ok(doc.getNumberOfPages()>1);
 for(let index=0;index<60;index++)assert.ok(pages.join('\n').includes('UNIQUE_EMPLOYEE_'+index),'No employee omitted across page breaks');
 for(const page of pages){assert.ok(page.includes('26/09/2026'));assert.ok(page.includes('50%')&&page.includes('100%'));}
 assert.equal(pages.filter(page=>page.includes('590:22:00')).length,1,'Final totals occur only on the last page');
 assert.ok(pages.at(-1).includes('DIRETOR DA UNIDADE'));
 console.log('Passed: alphabetical order with accents, empty and zero hours, immutable inputs, server totals, portrait A4 and pagination.');
}finally{await rm(directory,{recursive:true,force:true});}
