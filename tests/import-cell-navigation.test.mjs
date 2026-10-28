import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=ts.transpileModule(readFileSync(new URL('../modules/importacoes/utils/cellNavigation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {importCellNavigation}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const entries=Object.freeze(['row-z','row-a','row-m','row-b'].map(id=>Object.freeze({id})));
const fields=Object.freeze(['FARM','WEIGHT','NOTES'].map(key=>Object.freeze({key})));
const cell=(entryId,fieldKey)=>({entryId,fieldKey});

test('Enter directions keep the field and use visible row order after sorting',()=>{
 assert.deepEqual(importCellNavigation(entries,fields,'row-a','WEIGHT','down'),[cell('row-m','WEIGHT'),cell('row-b','WEIGHT')]);
 assert.deepEqual(importCellNavigation(entries,fields,'row-m','WEIGHT','up'),[cell('row-a','WEIGHT'),cell('row-z','WEIGHT')]);
});

test('Tab wraps to the next visible row and returns all subsequent candidates',()=>{
 assert.deepEqual(importCellNavigation(entries,fields,'row-a','NOTES','next'),[
  cell('row-m','FARM'),cell('row-m','WEIGHT'),cell('row-m','NOTES'),
  cell('row-b','FARM'),cell('row-b','WEIGHT'),cell('row-b','NOTES'),
 ]);
 assert.deepEqual(importCellNavigation(entries,fields,'row-b','FARM','next'),[cell('row-b','WEIGHT'),cell('row-b','NOTES')]);
});

test('Shift+Tab wraps to the previous row in reverse visible column order',()=>{
 assert.deepEqual(importCellNavigation(entries,fields,'row-m','FARM','previous'),[
  cell('row-a','NOTES'),cell('row-a','WEIGHT'),cell('row-a','FARM'),
  cell('row-z','NOTES'),cell('row-z','WEIGHT'),cell('row-z','FARM'),
 ]);
 assert.deepEqual(importCellNavigation(entries,fields,'row-z','NOTES','previous'),[cell('row-z','WEIGHT'),cell('row-z','FARM')]);
});

test('navigation stops at document boundaries without returning the current cell',()=>{
 assert.deepEqual(importCellNavigation(entries,fields,'row-b','WEIGHT','down'),[]);
 assert.deepEqual(importCellNavigation(entries,fields,'row-z','WEIGHT','up'),[]);
 assert.deepEqual(importCellNavigation(entries,fields,'row-b','NOTES','next'),[]);
 assert.deepEqual(importCellNavigation(entries,fields,'row-z','FARM','previous'),[]);
 for(const move of ['down','up','next','previous'])assert.deepEqual(importCellNavigation([{id:'only'}],[{key:'only'}],'only','only',move),[]);
});

test('filtered rows and reordered columns are the complete navigation scope',()=>{
 const visible=[entries[3],entries[1]],columns=[fields[2],fields[0]];
 assert.deepEqual(importCellNavigation(visible,columns,'row-b','FARM','next'),[cell('row-a','NOTES'),cell('row-a','FARM')]);
 assert.deepEqual(importCellNavigation(visible,columns,'row-a','NOTES','up'),[cell('row-b','NOTES')]);
 assert.deepEqual(importCellNavigation(visible,columns,'row-m','FARM','next'),[],'Hidden rows cannot be navigation anchors');
 assert.deepEqual(importCellNavigation(visible,columns,'row-b','WEIGHT','down'),[],'Hidden columns cannot be navigation anchors');
});

test('missing rows, missing fields and empty grids return no candidates',()=>{
 for(const move of ['down','up','next','previous']){
  assert.deepEqual(importCellNavigation([],fields,'row-a','FARM',move),[]);
  assert.deepEqual(importCellNavigation(entries,[],'row-a','FARM',move),[]);
  assert.deepEqual(importCellNavigation(entries,fields,'missing','FARM',move),[]);
  assert.deepEqual(importCellNavigation(entries,fields,'row-a','missing',move),[]);
 }
});
