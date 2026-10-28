import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const transpile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const reactUrl=pathToFileURL(require.resolve('react')).href;
const jsxUrl=pathToFileURL(require.resolve('react/jsx-runtime')).href;
const sharedUrl=dataUrl(transpile('../shared/utils/presentation.ts'));
const presentationUrl=dataUrl(transpile('../modules/importacoes/utils/presentation.ts').replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(sharedUrl)}`));
const source=transpile('../modules/importacoes/components/ImportWeightSummary.tsx')
 .replace(/from ['"]react['"]/g,`from ${JSON.stringify(reactUrl)}`)
 .replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`)
 .replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(sharedUrl)}`)
 .replace(/from ['"]\.\.\/utils\/presentation['"]/g,`from ${JSON.stringify(presentationUrl)}`);
const {ImportWeightSummary}=await import(dataUrl(source));
const metrics={entryCount:1,tripCount:1,grossWeight:'12.250',netWeight:'10.125',grossMissingCount:0,netMissingCount:0};
function fixture(){return {...metrics,entryCount:321,tripCount:99,equipmentCount:88,grossWeight:'12345678901234567890.123456789012',netWeight:'0.000001',unlinkedEntryCount:0,partialTripCount:0,
 equipment:[{...metrics,key:'000123',equipmentCodes:['000123'],status:'assigned'},{...metrics,key:'198',equipmentCodes:['198'],status:'assigned'}],
 trips:[{...metrics,key:'source-trip',entryNumbers:['1143'],groupOrdinal:1,date:'2026-10-27',equipmentCodes:['000123'],totalEntryCount:1,partial:false,linked:true}],
 groupSizes:[{entryCount:3,tripCount:7}]};}
function render(summary=fixture(),updating=false){return renderToStaticMarkup(createElement(ImportWeightSummary,{summary,updating}));}

test('screen summary renders exact server decimal strings and server counts instead of deriving totals from equipment rows',()=>{
 const summary=fixture();const before=structuredClone(summary);const html=render(summary);
 assert.match(html,/12\.345\.678\.901\.234\.567\.890,123456789012/);
 assert.match(html,/0,000001/);
 assert.match(html,/<dt>Viagens<\/dt><dd>99<\/dd>/);
 assert.match(html,/<dt>Equipamentos<\/dt><dd>88<\/dd>/);
 assert.match(html,/321 lançamentos no resumo/);
 assert.match(html,/<strong>7<\/strong> viagens com 3 lançamentos por conjunto/);
 const footer=html.match(/<tfoot>([\s\S]*?)<\/tfoot>/)?.[1];assert.ok(footer);
 assert.match(footer,/>99<\/td>/);assert.match(footer,/>321<\/td>/);assert.match(footer,/12\.345\.678\.901\.234\.567\.890,123456789012/);
 assert.deepEqual(summary,before,'Rendering must not rewrite server metrics');
});

test('equipment is the default grouping and preserves text codes without inventing trip rows',()=>{
 const html=render();
 assert.match(html,/<button type="button" aria-pressed="true">Por equipamento<\/button>/);
 assert.match(html,/<button type="button" aria-pressed="false">Por viagem<\/button>/);
 assert.match(html,/aria-label="Resumo de pesos e viagens por equipamento"/);
 assert.match(html,/>000123<\/span>/);assert.match(html,/12,250/);
 assert.doesNotMatch(html,/Entrada 1143/);
 assert.match(html,/Este resumo aparece somente no sistema/);
});

test('missing weights, conflicting equipment and partial filters remain explicit rather than becoming zero',()=>{
 const summary=fixture();summary.grossWeight=null;summary.netWeight=null;summary.grossMissingCount=2;summary.netMissingCount=3;summary.partialTripCount=4;summary.unlinkedEntryCount=5;
 summary.equipment=[{...metrics,key:'missing',equipmentCodes:[],status:'missing',grossWeight:null,netWeight:null,grossMissingCount:1,netMissingCount:1},{...metrics,key:'conflict',equipmentCodes:['000123','198'],status:'conflict'}];
 const html=render(summary);
 assert.match(html,/class="imports-weight-number">—<\/span>/);
 assert.match(html,/Parcial · 2 lançamento\(s\) sem peso/);assert.match(html,/Parcial · 3 lançamento\(s\) sem peso/);
 assert.match(html,/Equipamento não informado/);assert.match(html,/Equipamentos divergentes/);assert.match(html,/000123 · 198/);
 assert.match(html,/4 viagem\(ns\) com parte dos lançamentos fora do filtro/);
 assert.match(html,/5 lançamento\(s\) sem conjunto identificado/);
 assert.doesNotMatch(html,/<span class="imports-weight-number">0<small> t<\/small><\/span>/);
});

test('an empty filtered summary displays supplied zero totals and no synthetic equipment table',()=>{
 const summary={...metrics,entryCount:0,tripCount:0,equipmentCount:0,grossWeight:'0',netWeight:'0',unlinkedEntryCount:0,partialTripCount:0,equipment:[],trips:[],groupSizes:[]};
 const html=render(summary);
 assert.match(html,/<dt>Viagens<\/dt><dd>0<\/dd>/);assert.match(html,/<dt>Equipamentos<\/dt><dd>0<\/dd>/);
 assert.match(html,/<span class="imports-weight-number">0<small> t<\/small><\/span>/);
 assert.match(html,/Nenhum lançamento neste filtro para resumir/);assert.doesNotMatch(html,/<table/);
 const unknown=render({...summary,grossWeight:null,netWeight:null});assert.match(unknown,/class="imports-weight-number">—<\/span>/);
});

test('background updates keep the supplied summary visible with an accessible busy status',()=>{
 const html=render(fixture(),true);
 assert.match(html,/aria-busy="true"/);assert.match(html,/role="status">Atualizando resumo…/);
 assert.match(html,/<dt>Viagens<\/dt><dd>99<\/dd>/);assert.match(html,/<table/);
 assert.match(render(fixture(),false),/aria-busy="false"/);
});
