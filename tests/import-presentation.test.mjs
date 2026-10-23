import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const transpile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const shared=url(transpile('../shared/utils/presentation.ts'));
const source=transpile('../modules/importacoes/utils/presentation.ts').replace(/from ['"]@\/shared\/utils\/presentation['"]/,`from ${JSON.stringify(shared)}`);
const {importValue,importCount,importFieldLabel,mainImportFields}=await import(url(source));
const {createTaquariProfile}=await import(url(transpile('../modules/importacoes/utils/defaults.ts')));

test('presentation formats exact decimal strings in pt-BR without losing precision or textual leading zeros',()=>{
 assert.equal(importValue({type:'decimal'},'123456789012345.123456'),'123.456.789.012.345,123456');
 assert.equal(importValue({type:'decimal'},'-1234.010'),'-1.234,010');assert.equal(importValue({type:'decimal'},'61.310'),'61,310');
 assert.equal(importValue({type:'text'},'000123'),'000123');assert.equal(importValue({type:'date'},'2026-10-22'),'22/10/2026');
 assert.equal(importCount(1234),'1.234');assert.equal(importCount(0),'0');assert.equal(importCount(undefined),'—');
});
test('main columns keep all original field types and reveal a selected hidden column',()=>{
 const fields=createTaquariProfile().fields;const original=JSON.stringify(fields);const visible=mainImportFields(fields,'COD_ENTRADA');
 assert.equal(visible.length,10);assert.equal(visible[0].key,'COD_ENTRADA');assert.equal(fields.length,46);
 const hidden=fields.find(field=>field.key==='COD_EQUIPAMENTO_COMPARTIMENTO');const expanded=mainImportFields(fields,hidden.key);
 assert.equal(expanded.length,11);assert.equal(expanded.at(-1),hidden);assert.equal(JSON.stringify(fields),original);
});
test('human column titles are presentation only and retain a configured custom label',()=>{
 assert.equal(importFieldLabel({key:'COD_FAZENDA',label:'COD FAZENDA'}),'Fazenda');
 assert.equal(importFieldLabel({key:'COD_FAZENDA',label:'Código no meu sistema'}),'Código no meu sistema');
});
