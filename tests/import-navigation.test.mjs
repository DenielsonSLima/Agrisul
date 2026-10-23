import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createModuleNavigation} from '../shared/navigation/navigationStore.ts';

const source=ts.transpileModule(readFileSync(new URL('../modules/importacoes/navigation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {importTabFromSearch,importTabHref}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('three import tabs use shareable URLs and unknown tabs default to open',()=>{
 for(const tab of ['open','finished','settings']){const url=new URL(importTabHref(tab),'https://billing.example');assert.equal(url.pathname,'/importacoes');assert.equal(importTabFromSearch(url.searchParams),tab);}
 assert.equal(importTabHref('settings'),'/importacoes?aba=configuracoes');
 assert.equal(importTabFromSearch(new URLSearchParams('aba=desconhecida')),'open');
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
