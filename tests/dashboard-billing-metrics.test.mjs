import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url),dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const jsxUrl=pathToFileURL(require.resolve('react/jsx-runtime')).href;
const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const sharedUrl=dataUrl(transpile(readFileSync(new URL('../shared/utils/presentation.ts',import.meta.url),'utf8')));
const valuesUrl=dataUrl(`import {moneyLabel} from ${JSON.stringify(sharedUrl)};
 export const display={visible:true};
 export const useDashboardValues=()=>({visible:display.visible,money:value=>display.visible?moneyLabel(value):'••••••'});`);
const {display}=await import(valuesUrl);
const page=readFileSync(new URL('../modules/resumo/components/ResumoPage.tsx',import.meta.url),'utf8');
const start=page.indexOf('function DashboardMetrics(');assert.ok(start>=0,'Evaluate the actual DashboardMetrics and Metric implementation');
const iconNames=page.match(/import \{([^}]+)\} from 'lucide-react';/)[1].split(',').map(value=>value.trim());
const metricsSource=`import {decimalLabel} from ${JSON.stringify(sharedUrl)};
 import {useDashboardValues} from ${JSON.stringify(valuesUrl)};
 const ${iconNames.map(name=>`${name}=()=>null`).join(',')};
 ${page.slice(start)}
 export {DashboardMetrics};`;
const metricsUrl=dataUrl(transpile(metricsSource).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`));
const {DashboardMetrics}=await import(metricsUrl);
const fixture={
 totals:{grossAmount:'519190.29',netAmount:'270683.04',discountAmount:'248507.25',loadedVolume:'1234.567',loadCount:19,billingPending:false,pendingLoadCount:0},
 operationalTotals:{averageAtr:'131.23',farmCount:3,loadCount:19},
 comparison:{from:'2025-10-01',to:'2025-10-31',loadedVolume:'694.46',netAmount:'143311.23',receivedAmount:'3000',volumeChangePercent:'77.77',netChangePercent:'88.88',receivedChangePercent:'-12.34'},
 dailyProductivity:{productionDayCount:7,averageLoadedVolume:'176.367',averageNetAmount:'38669.01',billingPending:false},
 averageGrossPricePerTon:'420.55',
};
const render=({scene='dashboard-financial',visible=true,totals={},comparison={}}={})=>{
 display.visible=visible;
 return renderToStaticMarkup(createElement(DashboardMetrics,{scene,data:{...fixture,totals:{...fixture.totals,...totals},comparison:{...fixture.comparison,...comparison}}}));
};
const card=(html,marker)=>{
 const match=html.match(new RegExp(`data-dashboard-metric="${marker}"[^>]*>([\\s\\S]*?)<\\/dd>`));
 assert.ok(match,`Expected the ${marker} card`);return match[1];
};
const markers=html=>[...html.matchAll(/data-dashboard-metric="([^"]+)"/g)].map(match=>match[1]);
const cardCount=html=>[...html.matchAll(/<dt>/g)].length;

test('billing renders four dedicated RPC metrics with exact labels and no operational or volume-change badge',()=>{
 const before=structuredClone(fixture),html=render();
 assert.match(html,/data-metric-count="4"/);assert.equal(cardCount(html),4);
 assert.deepEqual(markers(html),['gross-amount','net-amount','discount-amount','loaded-volume']);
 for(const [marker,name,amount] of [['gross-amount','Faturamento bruto','R$ 519.190,29'],['net-amount','Faturamento líquido','R$ 270.683,04'],['discount-amount','Descontos','R$ 248.507,25'],['loaded-volume','Toneladas carregadas','1.234,57']]){
  const output=card(html,marker);assert.ok(output.includes(name));assert.ok(output.includes(`title="${amount}"`));assert.ok(output.includes(`<span>${amount}</span>`));
 }
 assert.match(card(html,'loaded-volume'),/<small>t<\/small>/);
 assert.doesNotMatch(html,/ATR médio ponderado|Média carregada \/ dia|Faturamento médio \/ dia|Venda média bruta \/ t/);
 assert.doesNotMatch(html,/77,77%/);
 assert.match(html,/\+88,88%/);assert.match(html,/vs\. período anterior/);assert.match(html,/01\/10\/2025 a 31\/10\/2025/);assert.match(html,/Anterior: R\$ 143\.311,23/);
 assert.deepEqual(fixture,before,'Presentation must not mutate or recalculate the RPC snapshot');
});

test('financial visibility masks metric text and titles while tonnes remain visible',()=>{
 const html=render({visible:false});
 for(const marker of ['gross-amount','net-amount','discount-amount']){
  const output=card(html,marker);assert.match(output,/title="••••••"/);assert.match(output,/<span>••••••<\/span>/);
 }
 for(const amount of ['519.190,29','270.683,04','248.507,25','143.311,23','88,88%'])assert.equal(html.includes(amount),false,'Hidden money and financial comparisons must be absent from all rendered text and accessibility attributes');
 assert.match(card(html,'loaded-volume'),/title="1\.234,57"/);assert.match(card(html,'loaded-volume'),/<small>t<\/small>/);
 assert.doesNotMatch(html,/R\$/);
});

test('pending billing preserves known discounts and tonnes without inventing zero gross or net amounts',()=>{
 const html=render({totals:{grossAmount:'',netAmount:'',discountAmount:'12.34',billingPending:true,pendingLoadCount:1}});
 for(const marker of ['gross-amount','net-amount']){
  const output=card(html,marker);assert.match(output,/title="A apurar"/);assert.match(output,/<span>A apurar<\/span>/);assert.doesNotMatch(output,/R\$ 0,00/);
 }
 assert.match(card(html,'discount-amount'),/title="R\$ 12,34"/);
 assert.match(card(html,'loaded-volume'),/1\.234,57/);
 assert.doesNotMatch(html,/88,88%/,'Pending current billing must not display a stale financial percentage');
 const hidden=render({visible:false,totals:{grossAmount:'',netAmount:'',discountAmount:'12.34',billingPending:true}});
 assert.doesNotMatch(hidden,/12,34|A apurar/);assert.match(card(hidden,'loaded-volume'),/1\.234,57/);
});

test('financial comparisons preserve unavailable and zero RPC percentages without recomputing them',()=>{
 const unavailable=render({comparison:{netChangePercent:'',netAmount:'0'}});
 assert.match(unavailable,/Sem comparação/);assert.match(unavailable,/Anterior: R\$ 0,00/);assert.doesNotMatch(unavailable,/88,88%/);
 const zero=render({comparison:{netChangePercent:'0'}});assert.match(zero,/0,00%/);assert.doesNotMatch(zero,/Sem comparação/);
 const clients=render({scene:'dashboard-suppliers'});assert.match(clients,/-12,34%/);assert.match(clients,/Anterior: R\$ 3\.000,00/);
 const hiddenClients=render({scene:'dashboard-suppliers',visible:false});assert.doesNotMatch(hiddenClients,/-12,34%|3\.000,00|R\$/);
});

test('zero, negative and long RPC amounts are displayed directly without client-side financial reconciliation',()=>{
 const html=render({totals:{grossAmount:'0',netAmount:'-12.34',discountAmount:'89.01',loadedVolume:'0'}});
 assert.match(card(html,'gross-amount'),/title="R\$ 0,00"/);assert.match(card(html,'net-amount'),/title="R\$ -12,34"/);assert.match(card(html,'discount-amount'),/title="R\$ 89,01"/);
 assert.match(card(html,'loaded-volume'),/title="0,00"/);assert.match(card(html,'loaded-volume'),/<small>t<\/small>/);
 const long=render({totals:{grossAmount:'1234567890123.45'}});
 assert.match(card(long,'gross-amount'),/title="R\$ 1\.234\.567\.890\.123,45"/);assert.match(card(long,'gross-amount'),/<span>R\$ 1\.234\.567\.890\.123,45<\/span>/);
});

test('dedicated billing metrics preserve the existing production and remaining Dashboard metric sets',()=>{
 const production=render({scene:'dashboard-production'});assert.match(production,/data-metric-count="4"/);assert.equal(cardCount(production),4);
 assert.match(production,/ATR médio ponderado/);assert.match(production,/Média carregada \/ dia/);assert.match(production,/Venda média bruta \/ t/);assert.doesNotMatch(production,/data-dashboard-metric="gross-amount"/);
 const clients=render({scene:'dashboard-suppliers'});assert.match(clients,/data-metric-count="4"/);assert.equal(cardCount(clients),4);
 assert.match(clients,/Recebido no período/);assert.match(clients,/A receber no período/);assert.doesNotMatch(clients,/Faturamento médio \/ dia/);
 const contracts=render({scene:'dashboard-contracts'});assert.match(contracts,/data-metric-count="3"/);assert.equal(cardCount(contracts),3);
 assert.deepEqual(markers(contracts),['loaded-volume','manual-volume','mechanized-volume']);assert.doesNotMatch(contracts,/Faturamento médio \/ dia|R\$/);
 for(const scene of [0,5]){
  const html=render({scene});assert.match(html,/data-metric-count="5"/);assert.equal(cardCount(html),5);
  assert.match(html,/ATR médio ponderado/);assert.match(html,/Faturamento médio \/ dia/);assert.doesNotMatch(html,/data-dashboard-metric="gross-amount"/);
 }
});
