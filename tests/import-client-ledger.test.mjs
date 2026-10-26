import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const transpile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const reactUrl=pathToFileURL(require.resolve('react')).href;
const jsxUrl=pathToFileURL(require.resolve('react/jsx-runtime')).href;
const fixturesUrl=dataUrl(`import {createElement} from ${JSON.stringify(reactUrl)};
export const state={data:null,loading:false,error:'',search:''};
export function useImportLedger(params){state.params=params;return {data:state.data,loading:state.loading,error:state.error,reload:async()=>{}}}
export function useClients(){return {clients:[{id:'client',legalName:'Empresa dos dois modelos',tradeName:''}]}}
export function useModuleNavigation(){return {searchParams:new URLSearchParams(state.search),navigate(){}}}
export function Field({label,children}){return createElement('label',null,createElement('span',null,label),children)}
export function ModuleLink({href,children,...props}){return createElement('a',{href,...props},children)}
const Icon=()=>null;export {Icon as ArrowLeft,Icon as ArrowUpRight,Icon as Building2,Icon as Check,Icon as ChevronRight,Icon as FileText,Icon as Filter,Icon as Loader2,Icon as Pencil,Icon as Upload,Icon as X};`);
const {state}=await import(fixturesUrl);
const sharedUrl=dataUrl(transpile('../shared/utils/presentation.ts'));
const presentationUrl=dataUrl(transpile('../modules/importacoes/utils/presentation.ts').replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(sharedUrl)}`));
const navigationUrl=dataUrl(transpile('../modules/importacoes/navigation.ts'));
let source=transpile('../modules/importacoes/components/ImportClientLedger.tsx');
source=source.replace(/from ['"]react['"]/g,`from ${JSON.stringify(reactUrl)}`).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`)
 .replace(/from ['"](?:lucide-react|@\/shared\/components\/Common|@\/shared\/navigation\/ModuleNavigation|@\/modules\/cadastro\/clientes\/hooks\/useClients|\.\.\/hooks\/useImportacoes)['"]/g,`from ${JSON.stringify(fixturesUrl)}`)
 .replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(sharedUrl)}`)
 .replace(/from ['"]\.\.\/navigation['"]/g,`from ${JSON.stringify(navigationUrl)}`)
 .replace(/from ['"]\.\.\/utils\/presentation['"]/g,`from ${JSON.stringify(presentationUrl)}`);
const {ImportClientLedger}=await import(dataUrl(source));
const {createElement}=await import(reactUrl);
const field=(key,type)=>({key,label:key.replaceAll('_',' '),type,column:'S',source:'manual',required:false,defaultValue:''});
const summary={dayCount:7,documentCount:2,entryCount:99,groupCount:8,pendingCount:75,reviewedCount:24,dateFrom:'2026-10-22',dateTo:'2026-10-25'};
const entry=(id,value)=>({id,date:'2026-10-22',values:{COD_EQUIPAMENTO_TRANSPORTE:value},source:{},reviewed:false,sourcePage:1,sourceLine:'',groupKey:id,groupOrdinal:1});
function fixture(){return {clientId:'client',clientName:'Empresa dos dois modelos',summary,facets:{farms:[{value:'0005010',label:'0005010'}],plots:[{value:'__empty__',label:'Não informado'}]},documents:[{id:'numeric',sourceName:'numeric.pdf',profileName:'Modelo numérico',status:'open',updatedAt:'one',fields:[field('COD_EQUIPAMENTO_TRANSPORTE','decimal')]},{id:'text',sourceName:'text.pdf',profileName:'Modelo textual',status:'open',updatedAt:'two',fields:[field('COD_EQUIPAMENTO_TRANSPORTE','text')]}],groups:[{key:'none',label:'Lançamentos',summary,entries:[{documentId:'numeric',entry:entry('a','123456789012345.123456'),groupBand:'odd',bandOrdinal:1,groupStart:true},{documentId:'text',entry:entry('b','000123'),groupBand:'even',bandOrdinal:2,groupStart:true}]}],canManage:true};}
function render(){return renderToStaticMarkup(createElement(ImportClientLedger,{clientId:'client',status:'open'}));}

test('company defaults to one ledger table across PDFs and displays server summary values instead of counting rows',()=>{
 state.data=fixture();state.search='cliente=client';const html=render();
 assert.equal((html.match(/<table/g)||[]).length,1);assert.match(html,/99 lançamentos/);assert.match(html,/<strong>75<\/strong>/);assert.equal(state.params.groupBy,'none');
 assert.match(html,/data-document-id="numeric"/);assert.match(html,/data-document-id="text"/);
 assert.match(html,/data-field-type="decimal"[^>]*>123\.456\.789\.012\.345,123456</);assert.match(html,/data-field-type="text"[^>]*>000123</);
 assert.match(html,/data-group-band="base"/);assert.match(html,/data-group-band="alternate"/);
 assert.match(html,/Conferir lançamento a/);assert.match(html,/Abrir documento numeric\.pdf/);
});

test('ledger filters, faceted ERP codes and editor return links retain the exact URL state',()=>{
 state.data=fixture();state.search='cliente=client&de=2026-10-22&ate=2026-10-25&fazenda=0005010&talhao=__empty__&agrupar=plot';const html=render();
 assert.deepEqual(state.params,{clientId:'client',status:'open',dateFrom:'2026-10-22',dateTo:'2026-10-25',farm:'0005010',plot:'__empty__',groupBy:'plot'});
 for(const label of ['Data inicial','Data final','Filtrar por fazenda','Filtrar por talhão','Agrupar lançamentos por','Resumo filtrado da empresa'])assert.ok(html.includes(`aria-label="${label}"`));
 assert.match(html,/value="0005010" selected=""/);assert.match(html,/value="__empty__" selected=""/);
 assert.match(html,/retorno=cliente[^\"]*fazenda=0005010[^\"]*talhao=__empty__[^\"]*agrupar=plot/);
 assert.match(html,/99 lançamentos · 75 para conferir/);
});

test('empty filtered results retain filters and a zero server summary without inventing a missing company',()=>{
 state.data=fixture();state.data.summary={...summary,dayCount:0,documentCount:0,entryCount:0,groupCount:0,pendingCount:0};state.data.groups=[];state.search='cliente=client&fazenda=unknown';const html=render();
 assert.match(html,/Empresa dos dois modelos/);assert.match(html,/Nenhum lançamento neste filtro/);assert.match(html,/value="unknown"/);assert.match(html,/0 lançamentos encontrados/);assert.doesNotMatch(html,/<table/);
});
