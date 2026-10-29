import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const transpile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const shared=url(transpile('../shared/utils/presentation.ts'));
const source=transpile('../modules/importacoes/utils/presentation.ts').replace(/from ['"]@\/shared\/utils\/presentation['"]/,`from ${JSON.stringify(shared)}`);
const {importValue,importCount,importFieldLabel,importGroupDecoration,mainImportFields}=await import(url(source));
const {createTaquariProfile}=await import(url(transpile('../modules/importacoes/utils/defaults.ts')));

test('presentation formats exact decimal strings in pt-BR without losing precision or textual leading zeros',()=>{
 assert.equal(importValue({type:'decimal'},'123456789012345.123456'),'123.456.789.012.345,123456');
 assert.equal(importValue({type:'decimal'},'-1234.010'),'-1.234,010');assert.equal(importValue({type:'decimal'},'61.310'),'61,310');
 assert.equal(importValue({type:'text'},'000123'),'000123');assert.equal(importValue({type:'date'},'2026-10-22'),'22/10/2026');
 assert.equal(importCount(1234),'1.234');assert.equal(importCount(0),'0');assert.equal(importCount(undefined),'—');
});
test('main columns keep all original field types and reveal a selected hidden column',()=>{
 const fields=createTaquariProfile().fields;const original=JSON.stringify(fields);const visible=mainImportFields(fields,'COD_ENTRADA');
 assert.equal(visible.length,12);assert.equal(visible[0].key,'COD_ENTRADA');assert.ok(visible.some(field=>field.key==='COD_TIPOCOLHEITA'));assert.ok(visible.some(field=>field.column==='S'));assert.ok(visible.some(field=>field.column==='Y'));assert.equal(fields.length,46);
 const hidden=fields.find(field=>field.key==='NUMERO_ANALISE');const expanded=mainImportFields(fields,hidden.key);
 assert.equal(expanded.length,13);assert.equal(expanded.at(-1),hidden);assert.equal(JSON.stringify(fields),original);
});
test('human column titles are presentation only and retain a configured custom label',()=>{
 assert.equal(importFieldLabel({key:'COD_FAZENDA',label:'COD FAZENDA'}),'Fazenda');
 assert.equal(importFieldLabel({key:'COD_FAZENDA',label:'Código no meu sistema'}),'Código no meu sistema');
});

test('all trailers in an RPC group share a band and only the next group changes its color',()=>{
 const entries=[{groupKey:'original-a',groupOrdinal:1},{groupKey:'original-a',groupOrdinal:1},{groupKey:'original-b',groupOrdinal:2},{groupKey:'original-b',groupOrdinal:2},{groupKey:'original-b',groupOrdinal:2},{groupKey:'original-c',groupOrdinal:3}];
 const decoration=entries.map((entry,index)=>importGroupDecoration(entry,entries[index-1]));
 assert.deepEqual(decoration.map(item=>item.band),['base','base','alternate','alternate','alternate','base']);
 assert.deepEqual(decoration.map(item=>item.start),[true,false,true,false,false,true]);
 assert.equal(decoration[1].key,'original-a');assert.equal(decoration[4].ordinal,2);
});

test('group decoration trusts the RPC ordinal across day filters and never infers grouping from editable ERP values',()=>{
 const source={groupKey:'server-projected-key',groupOrdinal:8,values:{COD_ENTRADA:'different-code',COD_FAZENDA:'5010'},source:{entrada:'2874'}};
 assert.equal(importGroupDecoration(source).band,'alternate');
 assert.equal(importGroupDecoration({...source,values:{COD_ENTRADA:'same-code',COD_FAZENDA:'5011'}}).band,'alternate');
 assert.deepEqual(importGroupDecoration({}),{key:null,ordinal:null,band:'none',start:false});
 assert.equal(importGroupDecoration({groupKey:'known',groupOrdinal:null}).band,'none');
 assert.equal(importGroupDecoration({groupKey:null,groupOrdinal:1}).band,'none');
 for(const ordinal of [0,-1,1.5,NaN,Infinity])assert.equal(importGroupDecoration({groupKey:'known',groupOrdinal:ordinal}).band,'none');
});
