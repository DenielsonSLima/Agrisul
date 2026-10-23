import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../modules/importacoes/utils/columnSelection.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {resolveColumnType}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('type picker opens with the actual numeric/date/text column type',()=>{
 assert.equal(resolveColumnType({key:'A',type:'decimal'},null),'decimal');assert.equal(resolveColumnType({key:'B',type:'date'},null),'date');assert.equal(resolveColumnType({key:'C',type:'text'},null),'text');
});
test('explicit type choice survives refetches while switching columns or a remote type change uses the current field',()=>{
 const draft={key:'A',sourceType:'decimal',value:'text'};assert.equal(resolveColumnType({key:'A',type:'decimal'},draft),'text');
 assert.equal(resolveColumnType({key:'B',type:'date'},draft),'date');assert.equal(resolveColumnType({key:'A',type:'date'},draft),'date');
});
