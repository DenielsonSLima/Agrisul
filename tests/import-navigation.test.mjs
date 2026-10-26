import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createModuleNavigation} from '../shared/navigation/navigationStore.ts';

const source=ts.transpileModule(readFileSync(new URL('../modules/importacoes/navigation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {importClientFiltersFromSearch,importClientHref,importDocumentHref,importTabFromSearch,importTabHref,importUploadHref,importProfileHref,importCloneProfileHref}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('three import tabs use shareable URLs and unknown tabs default to open',()=>{
 for(const tab of ['open','finished','settings']){const url=new URL(importTabHref(tab),'https://billing.example');assert.equal(url.pathname,'/importacoes');assert.equal(importTabFromSearch(url.searchParams),tab);}
 assert.equal(importTabHref('settings'),'/importacoes?aba=configuracoes');
 assert.equal(importTabFromSearch(new URLSearchParams('aba=desconhecida')),'open');
});

test('company ledger filters and grouping survive document and entry navigation without altering ERP text codes',()=>{
 const filters={dateFrom:'2026-10-22',dateTo:'2026-10-25',farm:'0005010',plot:'__empty__',groupBy:'source-group'};
 const company=new URL(importClientHref('client-one','finished',filters),'https://billing.example');
 assert.deepEqual(importClientFiltersFromSearch(company.searchParams),filters);assert.equal(importTabFromSearch(company.searchParams),'finished');
 const entry=new URL(importDocumentHref('document-one',{clientId:'client-one',tab:'finished',date:'2026-10-23',entryId:'entry-one',returnToClient:true,filters}),'https://billing.example');
 assert.deepEqual(importClientFiltersFromSearch(entry.searchParams),filters);assert.equal(entry.searchParams.get('retorno'),'cliente');assert.equal(entry.searchParams.get('dia'),'2026-10-23');
 const cleared=new URL(importClientHref('client-one','open',{groupBy:'none'}),'https://billing.example');assert.equal(cleared.searchParams.get('agrupar'),null);assert.deepEqual(importClientFiltersFromSearch(cleared.searchParams),{dateFrom:undefined,dateTo:undefined,farm:undefined,plot:undefined,groupBy:'none'});
 assert.equal(importClientFiltersFromSearch(new URLSearchParams('agrupar=invalid')).groupBy,'none');
});

test('module navigation restores import tabs on browser back and forward',()=>{
 const entries=[new URL('https://billing.example/importacoes')];let position=0;const listeners=new Map();
 const host={get location(){return entries[position]},history:{state:{preserved:true},pushState(state,unused,path){entries.splice(position+1);entries.push(new URL(path,entries[position]));position++;this.state=state;},replaceState(state,unused,path){entries[position]=new URL(path,entries[position]);this.state=state;}},addEventListener(name,listener){listeners.set(name,listener);},removeEventListener(name){listeners.delete(name);}};
 const navigation=createModuleNavigation('/importacoes',host);navigation.connect();
 const selected=()=>importTabFromSearch(new URL(navigation.getSnapshot(),'https://billing.example').searchParams);
 navigation.navigate(importTabHref('finished'));navigation.navigate(importTabHref('settings'));assert.equal(selected(),'settings');
 position--;listeners.get('popstate')();assert.equal(selected(),'finished');
 position--;listeners.get('popstate')();assert.equal(selected(),'open');
 position++;listeners.get('popstate')();assert.equal(selected(),'finished');
});

test('legacy configuration link redirects without advertising a global settings card',()=>{
 const page=readFileSync(new URL('../modules/configuracoes/components/ConfiguracoesPage.tsx',import.meta.url),'utf8');
 const sections=readFileSync(new URL('../modules/configuracoes/sections.ts',import.meta.url),'utf8');
 assert.match(page,/searchParams\.get\("secao"\)===\"importacoes\"/);
 assert.match(page,/navigate\('\/importacoes\?aba=configuracoes',\{replace:true\}\)/);
 assert.doesNotMatch(sections,/id:"importacoes"/);
});

test('document and entry screens retain the selected day and list tab in deep links',()=>{
 const document=new URL(importDocumentHref('pdf/one',{tab:'finished',date:'2026-10-22'}),'https://billing.example');
 assert.equal(document.searchParams.get('documento'),'pdf/one');assert.equal(document.searchParams.get('dia'),'2026-10-22');assert.equal(importTabFromSearch(document.searchParams),'finished');
 const entry=new URL(importDocumentHref('pdf/one',{tab:'finished',date:'2026-10-22',entryId:'entry two'}),'https://billing.example');
 assert.equal(entry.searchParams.get('lancamento'),'entry two');assert.equal(entry.searchParams.get('novo'),null);assert.equal(importTabFromSearch(entry.searchParams),'finished');
 const manual=new URL(importDocumentHref('pdf/one',{date:'2026-10-22',newEntry:true}),'https://billing.example');
 assert.equal(manual.searchParams.get('novo'),'1');assert.equal(manual.searchParams.get('dia'),'2026-10-22');assert.equal(manual.searchParams.get('lancamento'),null);
 assert.equal(importUploadHref(),'/importacoes?importar=1');
});

test('a cloned model opens in its own configuration editor route',()=>{
 const edit=new URL(importProfileHref('clone one'),'https://billing.example');assert.equal(importTabFromSearch(edit.searchParams),'settings');assert.equal(edit.searchParams.get('modelo'),'clone one');
 const create=new URL(importProfileHref(),'https://billing.example');assert.equal(create.searchParams.get('novoModelo'),'1');assert.equal(create.searchParams.get('modelo'),null);
 const clone=new URL(importCloneProfileHref('original one'),'https://billing.example');assert.equal(clone.searchParams.get('clonar'),'original one');assert.equal(importTabFromSearch(clone.searchParams),'settings');
});

test('company, day and editor routes retain the selected client and finalized status',()=>{
 const company=new URL(importClientHref('client one','finished'),'https://billing.example');assert.equal(company.searchParams.get('cliente'),'client one');assert.equal(importTabFromSearch(company.searchParams),'finished');
 const entry=new URL(importDocumentHref('doc-one',{clientId:'client one',tab:'finished',date:'2026-10-22',entryId:'entry-one',returnToClient:true}),'https://billing.example');
 assert.equal(entry.searchParams.get('cliente'),'client one');assert.equal(entry.searchParams.get('dia'),'2026-10-22');assert.equal(entry.searchParams.get('retorno'),'cliente');assert.equal(importTabFromSearch(entry.searchParams),'finished');
 const upload=new URL(importUploadHref('client one'),'https://billing.example');assert.equal(upload.searchParams.get('cliente'),'client one');assert.equal(upload.searchParams.get('importar'),'1');
});

test('browser history returns from entry screen to document and then to its list',()=>{
 const entries=[new URL('https://billing.example/importacoes?aba=finalizados')];let position=0;const listeners=new Map();
 const host={get location(){return entries[position]},history:{state:null,pushState(state,unused,path){entries.splice(position+1);entries.push(new URL(path,entries[position]));position++;this.state=state;},replaceState(state,unused,path){entries[position]=new URL(path,entries[position]);this.state=state;}},addEventListener(name,listener){listeners.set(name,listener);},removeEventListener(name){listeners.delete(name);}};
 const navigation=createModuleNavigation('/importacoes?aba=finalizados',host);navigation.connect();
 const documentHref=importDocumentHref('pdf-one',{tab:'finished',date:'2026-10-22'});const entryHref=importDocumentHref('pdf-one',{tab:'finished',date:'2026-10-22',entryId:'entry-one'});
 navigation.navigate(documentHref);navigation.navigate(entryHref);assert.equal(navigation.getSnapshot(),entryHref);
 position--;listeners.get('popstate')();assert.equal(navigation.getSnapshot(),documentHref);
 position--;listeners.get('popstate')();assert.equal(navigation.getSnapshot(),'/importacoes?aba=finalizados');
 position++;listeners.get('popstate')();assert.equal(navigation.getSnapshot(),documentHref);
});
