import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url),dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const reactUrl=pathToFileURL(require.resolve('react')).href,jsxUrl=pathToFileURL(require.resolve('react/jsx-runtime')).href;
const transpile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const chartsUrl=dataUrl(`import {createElement} from ${JSON.stringify(reactUrl)};const Box=({children})=>createElement('div',null,children);export const Cell=()=>null,ChartPie=()=>null,Pie=Box,PieChart=Box,ResponsiveContainer=Box;`);
const sharedUrl=dataUrl(transpile('../shared/utils/presentation.ts'));
const valuesUrl=dataUrl(transpile('../modules/resumo/dashboardValues.tsx').replace(/from ['"]react['"]/g,`from ${JSON.stringify(reactUrl)}`).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`).replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(sharedUrl)}`));
const {DashboardValuesProvider,dashboardValuesKey,DASHBOARD_MONEY_MASK}=await import(valuesUrl);
const source=transpile('../modules/resumo/components/FinancialComposition.tsx').replace(/from ['"]react['"]/g,`from ${JSON.stringify(reactUrl)}`).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`).replace(/from ['"](?:lucide-react|recharts)['"]/g,`from ${JSON.stringify(chartsUrl)}`).replace(/from ['"]\.\.\/dashboardValues['"]/g,`from ${JSON.stringify(valuesUrl)}`);
const {FinancialComposition}=await import(dataUrl(source));
const totals={grossAmount:'519190.29',netAmount:'270683.04',discountAmount:'248507.25',billingPending:false};
const render=values=>renderToStaticMarkup(createElement(FinancialComposition,{totals:{...totals,...values}}));

test('gross, net and discounts remain visible outside the ring without hover',()=>{
 const html=render();assert.match(html,/R\$ 519\.190,29/);assert.match(html,/R\$ 270\.683,04/);assert.match(html,/R\$ 248\.507,25/);
 const chart=html.split('financial-composition-chart')[1].split('financial-composition-values')[0];assert.doesNotMatch(chart,/<strong/,'The amount cannot collide with a shrinking ring');
 assert.ok(html.indexOf('financial-composition-gross')<html.indexOf('financial-composition-chart'));
 assert.match(html,/--composition-value-length:13/);assert.doesNotMatch(html,/summary-donut/);
});
test('long values retain their complete text and provide length for responsive typography',()=>{
 const html=render({grossAmount:'1234567890123.45',netAmount:'1000000000000',discountAmount:'234567890123.45'});
 assert.match(html,/R\$ 1\.234\.567\.890\.123,45/);assert.doesNotMatch(html,/title="R\$/);assert.match(html,/--composition-value-length:23/);
});
test('pending or non-proportional totals retain exact labels and a neutral ring',()=>{
 const pending=render({grossAmount:'',netAmount:'',discountAmount:'',billingPending:true});assert.match(pending,/Valores a apurar/);assert.match(pending,/A apurar/);assert.doesNotMatch(pending,/R\$ 0,00/);assert.match(pending,/<circle/);
 const negative=render({grossAmount:'100',netAmount:'-100',discountAmount:'200'});assert.match(negative,/Sem composição proporcional/);assert.match(negative,/R\$ -100,00/);assert.match(negative,/<circle/);
});

test('dashboard visibility preferences isolate accounts and hidden SSR output contains no financial amount or accessible label',()=>{
 assert.notEqual(dashboardValuesKey('owner-a'),dashboardValuesKey('owner-b'));assert.equal(dashboardValuesKey(null),null);
 const html=renderToStaticMarkup(createElement(DashboardValuesProvider,{userId:'owner-a'},createElement(FinancialComposition,{totals})));
 assert.match(html,/R\$ \*\*\*,\*\*/);for(const value of ['519.190,29','270.683,04','248.507,25'])assert.equal(html.includes(value),false,'Hidden amounts are absent from text and accessibility labels');
 assert.equal(DASHBOARD_MONEY_MASK,'R$ ***,**');assert.match(render(),/R\$ 519\.190,29/,'Masking is scoped to the Dashboard provider');
});
