import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../modules/resumo/components/DashboardVisuals.tsx',import.meta.url),'utf8');
const start=source.indexOf('export function DashboardHarvest('),end=source.indexOf('export function DashboardContractList(',start);
assert.ok(start>=0&&end>start);
const extracted=`import React from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};
const palette=['#187653','#b58a43','#91a39d'];
const decimalLabel=value=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));
function DashboardPanel({children,subtitle}){return <section><p>{subtitle}</p>{children}</section>;}
${source.slice(start,end)}`;
const {DashboardHarvest}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(extracted,{compilerOptions:{module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64'));
const render=unknown=>renderToStaticMarkup(createElement(DashboardHarvest,{data:{totals:{loadedVolume:'5877.280'},harvestMethods:[
 {code:'1',label:'Manual',loadedVolume:'4098.400',loadCount:27},
 {code:'2',label:'Mecanizada',loadedVolume:'1778.880',loadCount:25},
 {code:'unknown',label:'Não classificado',loadedVolume:'0',loadCount:0,...unknown},
]}}));

test('linked contracts show their complete modality totals without an empty unclassified card',()=>{
 const html=render();
 assert.match(html,/Classificação pelo tipo dos contratos vinculados/);
 assert.match(html,/4\.098,40/);assert.match(html,/1\.778,88/);
 assert.match(html,/27 carga\(s\)/);assert.match(html,/25 carga\(s\)/);
 assert.match(html,/--harvest-columns:2/);
 assert.doesNotMatch(html,/Não informado|Não classificado/);
});

test('loads linked to genuinely generic contract types keep an explicit unclassified card',()=>{
 const html=render({loadedVolume:'3.125',loadCount:1});
 assert.match(html,/--harvest-columns:3/);assert.match(html,/Não classificado/);
 assert.match(html,/3,13/);assert.match(html,/1 carga\(s\)/);
});
