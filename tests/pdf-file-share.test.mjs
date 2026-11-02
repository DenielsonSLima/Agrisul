import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../shared/reporting/sharePdfFile.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const {sharePdfFile}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const file=new File(['%PDF-1.4\nreport bytes'],'Relatório de horas extras - 26-10-2026 a 25-11-2026.pdf',{type:'application/pdf'});

test('native share receives the PDF attachment and its period filename during the click',async()=>{
 let shared;
 const pending=sharePdfFile(file,{canShare:data=>data.files[0]===file,share:data=>{shared=data;return Promise.resolve();}});
 assert.ok(shared,'Native sharing must start synchronously, preserving user activation');
 assert.deepEqual(shared.files,[file]);
 assert.equal(shared.title,'Relatório de horas extras - 26-10-2026 a 25-11-2026');
 assert.equal(shared.files[0].type,'application/pdf');
 assert.equal(await shared.files[0].text(),'%PDF-1.4\nreport bytes');
 assert.equal('url' in shared,false,'A private page/blob link must never replace the actual attachment');
 assert.equal(await pending,'shared');
});
test('unsupported browsers request the download fallback without sharing a page link',async()=>{
 let calls=0;
 for(const target of [{},{share:()=>{calls++;return Promise.resolve();}},{canShare:()=>false,share:()=>{calls++;return Promise.resolve();}}])assert.equal(await sharePdfFile(file,target),'unsupported');
 assert.equal(calls,0);
});
test('cancelling the share sheet is quiet while real failures remain visible',async()=>{
 assert.equal(await sharePdfFile(file,{canShare:()=>true,share:()=>Promise.reject(new DOMException('Cancelled','AbortError'))}),'cancelled');
 await assert.rejects(sharePdfFile(file,{canShare:()=>true,share:()=>Promise.reject(new DOMException('Not allowed','NotAllowedError'))}),error=>error.name==='NotAllowedError');
});
