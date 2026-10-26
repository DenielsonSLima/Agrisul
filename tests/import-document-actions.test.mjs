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
const reactUrl=pathToFileURL(require.resolve('react')).href,jsxUrl=pathToFileURL(require.resolve('react/jsx-runtime')).href;
const icons=['ArrowLeft','ArrowRight','ChevronRight','Building2','CalendarDays','Check','CheckCheck','ClipboardList','Download','FileText','FolderOpen','Info','Loader2','Pencil','Plus','RotateCcw','Search','Settings2','Trash2','Upload'];
const fixturesUrl=dataUrl(`import {createElement} from ${JSON.stringify(reactUrl)};
export const state={document:null,saving:false,calls:[]};
export function useImportDocument(){return {data:{document:state.document},loading:false,error:'',reload:async()=>{}}}
export function useImportProfiles(){return {data:{profiles:[],canManage:true},loading:false,error:'',reload:async()=>{}}}
export function useImportDocuments(){return {}}
export function useImportMutations(){return {saving:state.saving,finalize:async()=>{state.calls.push('finalize')},exportDocument:async()=>{state.calls.push('export')}}}
export function useAuth(){return {user:{id:'owner'}}}
export function useClients(){return {clients:[]}}
export function useModuleNavigation(){return {searchParams:new URLSearchParams('documento=doc&cliente=client'),navigate(){}}}
export function Field({label,children}){return createElement('label',null,createElement('span',null,label),children)}
export function ModuleLink({href,children,...props}){return createElement('a',{href,...props},children)}
export const notifications={};export function useConfirmation(){return async()=>true}
const Icon=()=>null;export {${icons.map(name=>`Icon as ${name}`).join(',')}};`);
const {state}=await import(fixturesUrl);
const sharedUrl=dataUrl(transpile('../shared/utils/presentation.ts'));
const presentationUrl=dataUrl(transpile('../modules/importacoes/utils/presentation.ts').replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(sharedUrl)}`));
const modules={'../navigation':dataUrl(transpile('../modules/importacoes/navigation.ts')),'../utils/columnSelection':dataUrl(transpile('../modules/importacoes/utils/columnSelection.ts')),'../utils/profileSelection':dataUrl(transpile('../modules/importacoes/utils/profileSelection.ts')),'../utils/presentation':presentationUrl,'@/shared/utils/presentation':sharedUrl};
let source=transpile('../modules/importacoes/components/ImportacoesPage.tsx');
source=source.replace(/from ['"]react['"]/g,`from ${JSON.stringify(reactUrl)}`).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`)
 .replace(/from ['"]([^'"]+)['"]/g,(match,path)=>path.startsWith('file:')?match:`from ${JSON.stringify(modules[path]??fixturesUrl)}`)
 .replace(/import ['"]\.\.\/styles\.css['"];?/g,'');
source+='\nexport {ImportDocumentPage};';
const {ImportDocumentPage}=await import(dataUrl(source));const {createElement}=await import(reactUrl);
function fixture(status){return {id:'doc',clientId:'client',clientName:'Empresa',sourceName:'incompleto.pdf',sourceHash:'hash',profileId:'profile',profileSnapshot:{name:'Modelo',fields:[{key:'COD_ENTRADA',label:'Entrada',column:'L',source:'manual',type:'decimal',required:true,defaultValue:''}]},status,entryCount:1,pendingCount:1,updatedAt:'revision',entries:[{id:'pending',date:'2026-10-22',values:{COD_ENTRADA:''},source:{},sourcePage:1,sourceLine:'',reviewed:false}]};}
function button(html,label){return html.match(new RegExp(`<button([^>]*)>[^<]*${label}</button>`))?.[1];}

test('an open incomplete document can export or finalize while blanks and review status remain unchanged',()=>{
 state.document=fixture('open');state.saving=false;state.calls=[];const before=JSON.stringify(state.document);const html=renderToStaticMarkup(createElement(ImportDocumentPage,{id:'doc'}));
 assert.notEqual(button(html,'Baixar Excel'),undefined);assert.doesNotMatch(button(html,'Baixar Excel'),/disabled/);assert.notEqual(button(html,'Finalizar'),undefined);assert.doesNotMatch(button(html,'Finalizar'),/disabled/);
 assert.match(html,/Campos vazios permanecem vazios/);assert.match(html,/finalizar não marca os lançamentos como conferidos/);assert.equal(JSON.stringify(state.document),before);assert.deepEqual(state.calls,[]);
});

test('a finalized document retains its pending warning and its export and reopen actions',()=>{
 state.document=fixture('finished');state.saving=false;const html=renderToStaticMarkup(createElement(ImportDocumentPage,{id:'doc'}));
 assert.doesNotMatch(button(html,'Baixar Excel'),/disabled/);assert.notEqual(button(html,'Reabrir'),undefined);assert.match(html,/1 lançamento\(s\) aguardam conferência/);assert.equal(state.document.entries[0].reviewed,false);assert.equal(state.document.entries[0].values.COD_ENTRADA,'');
});

test('document actions still prevent duplicate requests while a mutation is in progress',()=>{
 state.document=fixture('open');state.saving=true;const html=renderToStaticMarkup(createElement(ImportDocumentPage,{id:'doc'}));
 assert.match(button(html,'Baixar Excel'),/disabled/);assert.match(button(html,'Finalizar'),/disabled/);state.saving=false;
});
