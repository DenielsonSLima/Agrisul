import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const input=readFileSync(new URL('../modules/importacoes/utils/templateMapping.ts',import.meta.url),'utf8');
const source=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {mergeTemplateFields}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const field=(key,column,type='text')=>({key,label:key,column,type,source:'manual',required:false,defaultValue:'',sourceKey:'',mappings:{}});
const evidence=(key,column,inferredType,extra={})=>({key,column,inferredType,observedTypes:inferredType?[inferredType]:[],formats:[],sampleRows:[],mixed:false,reason:'Evidência das células',...extra});
const inspection=(fields,columnTypes)=>({fields,columnTypes,warnings:[],sheetNames:['Dados'],sheetName:'Dados',startRow:2,templateBase64:'',templateName:'modelo.xlsx'});

test('uses native Excel evidence, preserves extraction rules and leaves blank columns configured',()=>{
 const current=[{...field('CODIGO','A'),source:'pdf',sourceKey:'equipamento',defaultValue:'0001',mappings:{'1':'0001'}},field('DATA','B','date'),field('VAZIA','C','decimal')];
 const result=mergeTemplateFields(current,inspection([field('CODIGO','A','decimal'),field('DATA','B','date'),field('VAZIA','C')],[evidence('CODIGO','A','decimal'),evidence('DATA','B','date'),evidence('VAZIA','C',null)]));
 assert.deepEqual(result.fields.map(item=>item.type),['decimal','date','decimal']);
 assert.equal(result.fields[0].sourceKey,'equipamento');assert.equal(result.fields[0].defaultValue,'0001');assert.deepEqual(result.fields[0].mappings,{'1':'0001'});
 assert.equal(current[0].type,'text');assert.equal(result.reviews[2].inferredType,null);
});

test('keeps textual leading zero codes and requires a choice for mixed columns',()=>{
 const result=mergeTemplateFields([field('CODIGO','A'),field('MISTO','B','decimal')],inspection([field('CODIGO','A'),field('MISTO','B')],[evidence('CODIGO','A','text',{formats:['@']}),evidence('MISTO','B',null,{mixed:true,observedTypes:['decimal','text']})]));
 assert.equal(result.fields[0].type,'text');assert.equal(result.fields[1].type,'decimal');assert.equal(result.reviews[1].requiresChoice,true);
});

test('matches reordered headers before column positions and preserves manual fields absent from workbook',()=>{
 const result=mergeTemplateFields([field('CODIGO','A'),field('DATA','B','date'),field('MANUAL','','text')],inspection([field('DATA','A','date'),field('CODIGO','B')],[evidence('DATA','A','date'),evidence('CODIGO','B','text')]));
 assert.equal(result.fields.find(item=>item.key==='CODIGO').column,'B');assert.equal(result.fields.find(item=>item.key==='DATA').column,'A');assert.equal(result.fields.find(item=>item.key==='MANUAL').column,'');
});

test('column-only matches and new blank columns require explicit confirmation',()=>{
 const result=mergeTemplateFields([field('ANTIGO','A','decimal')],inspection([field('RENOMEADO','A'),field('NOVA','B')],[evidence('RENOMEADO','A','text'),evidence('NOVA','B',null)]));
 assert.equal(result.reviews[0].requiresChoice,true);assert.match(result.reviews[0].reason,/cabeçalho/);assert.equal(result.reviews[1].requiresChoice,true);
});
