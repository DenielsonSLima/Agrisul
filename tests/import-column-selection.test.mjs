import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../modules/importacoes/utils/columnSelection.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {resolveColumnType,visibleImportSelection,toggleVisibleImportSelection}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('type picker opens with the actual numeric/date/text column type',()=>{
 assert.equal(resolveColumnType({key:'A',type:'decimal'},null),'decimal');assert.equal(resolveColumnType({key:'B',type:'date'},null),'date');assert.equal(resolveColumnType({key:'C',type:'text'},null),'text');
});
test('explicit type choice survives refetches while switching columns or a remote type change uses the current field',()=>{
 const draft={key:'A',sourceType:'decimal',value:'text'};assert.equal(resolveColumnType({key:'A',type:'decimal'},draft),'text');
 assert.equal(resolveColumnType({key:'B',type:'date'},draft),'date');assert.equal(resolveColumnType({key:'A',type:'date'},draft),'date');
});

test('write selection contains only visible IDs in table order without discarding hidden selections',()=>{
 const selected=['hidden','b','a','b'];const before=[...selected];
 assert.deepEqual(visibleImportSelection([{id:'a'},{id:'other'},{id:'b'},{id:'a'}],selected),['a','b']);
 assert.deepEqual(visibleImportSelection([{id:'b'}],selected),['b']);
 assert.deepEqual(visibleImportSelection([],selected),[]);
 assert.deepEqual(selected,before,'Building a visible write selection never mutates the complete selection');
});

test('selecting all filtered rows preserves hidden IDs and deduplicates both stored and visible IDs',()=>{
 const selected=['hidden','b','hidden'];const entries=[{id:'a'},{id:'b'},{id:'a'},{id:'c'}];
 assert.deepEqual(toggleVisibleImportSelection(selected,entries,true),['hidden','b','a','c']);
 assert.deepEqual(selected,['hidden','b','hidden']);assert.deepEqual(entries,[{id:'a'},{id:'b'},{id:'a'},{id:'c'}]);
 assert.deepEqual(toggleVisibleImportSelection(['hidden','hidden'],[],true),['hidden']);
});

test('clearing selected filtered rows removes only visible IDs and retains the hidden selection',()=>{
 const selected=['hidden','a','b','hidden'];const visible=[{id:'a'},{id:'b'},{id:'a'}];
 assert.deepEqual(toggleVisibleImportSelection(selected,visible,false),['hidden']);
 const preserved=toggleVisibleImportSelection(['hidden','a'],[{id:'a'}],false);
 assert.deepEqual(visibleImportSelection([{id:'hidden'},{id:'a'}],preserved),['hidden'],'A selection hidden by filtering reappears when its row becomes visible');
 assert.deepEqual(toggleVisibleImportSelection(['hidden','hidden'],[],false),['hidden']);
});
