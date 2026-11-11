import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const transpile=name=>ts.transpileModule(readFileSync(new URL(`../modules/importacoes/utils/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const equipmentUrl='data:text/javascript;base64,'+Buffer.from(transpile('equipmentFields')).toString('base64');
const source=transpile('cellNavigation').replace("from './equipmentFields'",`from ${JSON.stringify(equipmentUrl)}`);
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

test('equipment Enter and Shift+Enter skip all rows of the current server group',()=>{
 const grouped=['a','a','b','b','b','c'].map((groupKey,index)=>({id:String(index),groupKey}));
 for(const key of ['COD_EQUIPAMENTO_TRANSPORTE','COD_EQUIPAMENTO_COMPARTIMENTO']){
  const columns=[{key}];
  assert.deepEqual(importCellNavigation(grouped,columns,'0',key,'down'),['2','3','4','5'].map(id=>cell(id,key)));
  assert.deepEqual(importCellNavigation(grouped,columns,'3',key,'up'),['1','0'].map(id=>cell(id,key)));
  assert.deepEqual(importCellNavigation(grouped,columns,'5',key,'down'),[]);
  assert.deepEqual(importCellNavigation(grouped,columns,'1',key,'up'),[]);
 }
});

test('equipment navigation respects filters and skips separated rows of the same trip after sorting',()=>{
 const key='COD_EQUIPAMENTO_TRANSPORTE',columns=[{key}];
 const grouped=[{id:'a1',groupKey:'a'},{id:'b1',groupKey:'b'},{id:'a2',groupKey:'a'},{id:'c1',groupKey:'c'}];
 assert.deepEqual(importCellNavigation(grouped,columns,'a1',key,'down'),[cell('b1',key),cell('c1',key)]);
 assert.deepEqual(importCellNavigation([grouped[0],grouped[2],grouped[3]],columns,'a1',key,'down'),[cell('c1',key)]);
});

test('rows without a group stay individual and other columns and Tab retain cell navigation',()=>{
 const key='COD_EQUIPAMENTO_TRANSPORTE',columns=[{key},{key:'COD_EQUIPAMENTO_COMPARTIMENTO'},{key:'COD_TALHAO'}];
 const grouped=[{id:'a1',groupKey:'a'},{id:'a2',groupKey:'a'},{id:'manual',groupKey:null},{id:'b1',groupKey:'b'}];
 assert.deepEqual(importCellNavigation(grouped,columns,'a2',key,'down'),[cell('manual',key),cell('b1',key)]);
 assert.deepEqual(importCellNavigation(grouped,columns,'manual',key,'up'),[cell('a2',key),cell('a1',key)]);
 assert.equal(importCellNavigation(grouped,columns,'a1','COD_TALHAO','down')[0].entryId,'a2');
 assert.deepEqual(importCellNavigation(grouped,columns,'a1',key,'next')[0],cell('a1','COD_EQUIPAMENTO_COMPARTIMENTO'));
 assert.deepEqual(importCellNavigation(grouped,columns,'a1','COD_EQUIPAMENTO_COMPARTIMENTO','previous')[0],cell('a1',key));
});
