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
const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const sharedUrl=dataUrl(transpile(readFileSync(new URL('../shared/utils/presentation.ts',import.meta.url),'utf8')));
const valuesUrl=dataUrl(`import {moneyLabel} from ${JSON.stringify(sharedUrl)};
 export const display={visible:true};
 export const useDashboardValues=()=>({visible:display.visible,money:value=>display.visible?moneyLabel(value):'••••••'});`);
const {display}=await import(valuesUrl);
const page=readFileSync(new URL('../modules/resumo/components/ResumoPage.tsx',import.meta.url),'utf8');
const start=page.indexOf('function DashboardMetrics(');assert.ok(start>=0,'Evaluate the real DashboardMetrics and Metric implementation');
const iconNames=page.match(/import \{([^}]+)\} from 'lucide-react';/)[1].split(',').map(value=>value.trim());
const metricsSource=`import {decimalLabel} from ${JSON.stringify(sharedUrl)};
 import {useDashboardValues} from ${JSON.stringify(valuesUrl)};
 const ${iconNames.map(name=>`${name}=()=>null`).join(',')};
 ${page.slice(start)}
 export {DashboardMetrics};`;
const metricsUrl=dataUrl(transpile(metricsSource).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`));
const {DashboardMetrics}=await import(metricsUrl);
const fixture={
 totals:{loadedVolume:'1234.567',loadCount:19,receivedAmount:'1200.13',pendingAmount:'7319.62',netAmount:'100',billingPending:false,pendingLoadCount:0},
 operationalTotals:{averageAtr:'131.23',farmCount:3,loadCount:19},
 comparison:{volumeChangePercent:'77.77'},
 dailyProductivity:{productionDayCount:7,averageLoadedVolume:'176.367',averageNetAmount:'38669.01',billingPending:false},
};
const renderMetrics=({visible=true,totals={},operation={}}={})=>{
 display.visible=visible;
 return renderToStaticMarkup(createElement(DashboardMetrics,{scene:'dashboard-suppliers',data:{...fixture,totals:{...fixture.totals,...totals},operationalTotals:{...fixture.operationalTotals,...operation}}}));
};
const card=(html,marker)=>{
 const match=html.match(new RegExp(`data-dashboard-metric="${marker}"[^>]*>([\\s\\S]*?)<\\/dd>`));
 assert.ok(match,`Expected the ${marker} card`);return match[1];
};

test('Clients has four dedicated metrics from the official snapshot, including the unmodified per-contract balance',()=>{
 const before=structuredClone(fixture),html=renderMetrics();
 assert.match(html,/data-metric-count="4"/);assert.equal([...html.matchAll(/<dt>/g)].length,4);
 assert.deepEqual([...html.matchAll(/data-dashboard-metric="([^"]+)"/g)].map(match=>match[1]),['loaded-volume','received-amount','pending-amount','average-atr']);
 for(const [marker,name,value] of [['loaded-volume','Entregue aos clientes','1.234,57'],['received-amount','Recebido no período','R$ 1.200,13'],['pending-amount','A receber no período','R$ 7.319,62'],['average-atr','ATR médio ponderado','131,23']]){
  const output=card(html,marker);assert.ok(output.includes(name));assert.ok(output.includes(`title="${value}"`));assert.ok(output.includes(`<span>${value}</span>`));
 }
 assert.match(card(html,'loaded-volume'),/<small>t<\/small>/);assert.match(card(html,'average-atr'),/<small>kg\/t<\/small>/);
 assert.match(html,/Adiantamentos e recebimentos, menos devoluções/);assert.match(html,/Saldo da seleção, por contrato/);
 assert.doesNotMatch(html,/Faturamento médio \/ dia|Faturamento líquido|Venda média bruta \/ t|Média carregada \/ dia/);
 assert.deepEqual(fixture,before,'Client balance must be displayed as returned, rather than recalculated from aggregate net and cash');
});

test('client financial visibility masks received and pending values in text and titles while volume and ATR stay visible',()=>{
 const html=renderMetrics({visible:false});
 for(const marker of ['received-amount','pending-amount']){assert.match(card(html,marker),/title="••••••"/);assert.match(card(html,marker),/<span>••••••<\/span>/);}
 assert.doesNotMatch(html,/1\.200,13|7\.319,62|R\$/);
 assert.match(card(html,'loaded-volume'),/title="1\.234,57"/);assert.match(card(html,'average-atr'),/title="131,23"/);
});

test('pending valuation does not erase known cash or measured ATR, and unknown ATR is never shown as zero',()=>{
 const html=renderMetrics({totals:{netAmount:'',pendingAmount:'',billingPending:true,pendingLoadCount:1}});
 assert.match(card(html,'pending-amount'),/title="A apurar"/);assert.doesNotMatch(card(html,'pending-amount'),/R\$ 0,00/);
 assert.match(card(html,'received-amount'),/title="R\$ 1\.200,13"/);assert.match(card(html,'average-atr'),/title="131,23"/);
 const unknown=renderMetrics({operation:{averageAtr:''}});assert.match(card(unknown,'average-atr'),/title="A apurar"/);assert.doesNotMatch(card(unknown,'average-atr'),/0,00/);
});

test('refund-only and empty periods preserve negative cash and zero official values without clamping or inventing receivables',()=>{
 const refund=renderMetrics({totals:{receivedAmount:'-100.13',pendingAmount:'42.27',netAmount:'0',loadedVolume:'0',loadCount:0}});
 assert.match(card(refund,'received-amount'),/title="R\$ -100,13"/);assert.match(card(refund,'pending-amount'),/title="R\$ 42,27"/);assert.match(card(refund,'loaded-volume'),/title="0,00"/);
 const empty=renderMetrics({totals:{receivedAmount:'0',pendingAmount:'0',loadedVolume:'0',loadCount:0},operation:{averageAtr:''}});
 assert.match(card(empty,'received-amount'),/title="R\$ 0,00"/);assert.match(card(empty,'pending-amount'),/title="R\$ 0,00"/);assert.match(card(empty,'average-atr'),/title="A apurar"/);
});
test('the separate Contract scene has three modality cards and never reuses client financial indicators',()=>{
 display.visible=true;
 const html=renderToStaticMarkup(createElement(DashboardMetrics,{scene:'dashboard-contracts',data:fixture}));
 assert.match(html,/data-metric-count="3"/);assert.equal([...html.matchAll(/<dt>/g)].length,3);
 assert.doesNotMatch(html,/received-amount|pending-amount|R\$ 1\.200,13|R\$ 7\.319,62|Faturamento médio/);
 assert.match(html,/Atualizando comparativo dos contratos/);
});

// Evaluate the real per-client cards; only measurement and surrounding panel
// rendering are adapted so SSR can cover short and tall plot layouts.
const plotUrl=dataUrl(`export const dimensions={width:500,height:0};export const usePlotSize=()=>({ref:()=>{},size:dimensions});`);
const {dimensions}=await import(plotUrl);
const panelsUrl=dataUrl(`import {createElement} from ${JSON.stringify(reactUrl)};
 export const DashboardPanel=({title,subtitle,actions,children})=>createElement('section',null,createElement('h3',null,title),createElement('p',null,subtitle),actions,children);
 export const DashboardEmpty=({text,detail})=>createElement('div',null,createElement('strong',null,text),createElement('p',null,detail));`);
const iconsUrl=dataUrl('export const ChevronLeft=()=>null,ChevronRight=()=>null;');
const listSource=transpile(readFileSync(new URL('../modules/resumo/components/DashboardClientList.tsx',import.meta.url),'utf8'))
 .replace(/from ['"]react['"]/g,`from ${JSON.stringify(reactUrl)}`)
 .replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`)
 .replace(/from ['"]lucide-react['"]/g,`from ${JSON.stringify(iconsUrl)}`)
 .replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(sharedUrl)}`)
 .replace(/from ['"]\.\.\/dashboardValues['"]/g,`from ${JSON.stringify(valuesUrl)}`)
 .replace(/from ['"]\.\.\/hooks\/usePlotSize['"]/g,`from ${JSON.stringify(plotUrl)}`)
 .replace(/from ['"]\.\/DashboardVisuals['"]/g,`from ${JSON.stringify(panelsUrl)}`);
const {DashboardClientList}=await import(dataUrl(listSource));
const client={id:'client-a',name:'AGRISUL AGRÍCOLA SOCIEDADE LIMITADA EM RECUPERAÇÃO JUDICIAL COM NOME COMPLETO PARA A FICHA',loadedVolume:'100.125',averageAtr:'135.57',receivedAmount:'-123.45',pendingAmount:'789.01',netAmount:'10',contractCount:3,loadCount:7,sharePercent:'75',billingPending:false};
const cashOnly={...client,id:'client-b',name:'Cliente sem entregas e com recebimentos',loadedVolume:'0',averageAtr:'',receivedAmount:'555.55',pendingAmount:'0',contractCount:1,loadCount:0,sharePercent:'0'};
const pendingClient={...client,id:'client-c',name:'Cliente com valoração pendente',loadedVolume:'20.5',averageAtr:'129.55',receivedAmount:'444.44',pendingAmount:'',netAmount:'',billingPending:true};
const renderList=({rows=[client],visible=true,height=0}={})=>{display.visible=visible;dimensions.height=height;return renderToStaticMarkup(createElement(DashboardClientList,{rows}));};
const stat=(html,marker)=>{
 const match=html.match(new RegExp(`data-client-stat="${marker}"[^>]*>([\\s\\S]*?)<\\/dd>`));
 assert.ok(match,`Expected the ${marker} per-client value`);return match[1];
};

test('client cards retain full names and exact official fields without recalculating or compensating balances',()=>{
 const before=structuredClone(client),html=renderList();
 assert.match(html,/Resumo por cliente/);assert.ok(html.includes(`>${client.name}</h4>`));assert.ok(html.includes(`title="${client.name}"`));
 assert.deepEqual([...html.matchAll(/data-client-stat="([^"]+)"/g)].map(match=>match[1]),['loaded-volume','average-atr','received-amount','pending-amount']);
 for(const [marker,value] of [['loaded-volume','100,13'],['average-atr','135,57'],['received-amount','R$ -123,45'],['pending-amount','R$ 789,01']])assert.ok(stat(html,marker).includes(`title="${value}"`));
 assert.match(html,/3 contratos · 7 cargas/);assert.match(html,/75,00% das entregas/);
 assert.deepEqual(client,before);
 const hidden=renderList({visible:false});assert.doesNotMatch(hidden,/-123,45|789,01|R\$/);
 for(const marker of ['received-amount','pending-amount'])assert.match(stat(hidden,marker),/title="••••••"/);
 assert.match(stat(hidden,'loaded-volume'),/title="100,13"/);assert.match(stat(hidden,'average-atr'),/title="135,57"/);
});

test('per-client cards preserve cash-only clients and known cash or ATR when valuation is pending',()=>{
 const cash=renderList({rows:[cashOnly]});assert.match(cash,/data-dashboard-client-id="client-b"/);assert.match(cash,/Sem entregas no período/);
 assert.match(stat(cash,'received-amount'),/title="R\$ 555,55"/);assert.match(stat(cash,'pending-amount'),/title="R\$ 0,00"/);assert.match(stat(cash,'loaded-volume'),/title="0,00"/);assert.match(stat(cash,'average-atr'),/title="A apurar"/);
 const pending=renderList({rows:[pendingClient]});assert.match(stat(pending,'received-amount'),/title="R\$ 444,44"/);assert.match(stat(pending,'average-atr'),/title="129,55"/);assert.match(stat(pending,'pending-amount'),/title="A apurar"/);assert.match(pending,/ATR ou cotação a apurar/);
 assert.match(renderList({rows:[]}),/Nenhum cliente nesta seleção/);
});

test('client-card pagination fits short and tall panels and exposes the remaining clients',()=>{
 const rows=[client,cashOnly,pendingClient],short=renderList({rows,height:299}),tall=renderList({rows,height:300});
 assert.match(short,/data-client-page-size="1"/);assert.equal([...short.matchAll(/data-dashboard-client-id=/g)].length,1);assert.match(short,/>1\/3</);assert.match(short,/aria-label="Próximos clientes"/);
 assert.match(tall,/data-client-page-size="2"/);assert.equal([...tall.matchAll(/data-dashboard-client-id=/g)].length,2);assert.match(tall,/data-dashboard-client-id="client-b"/);assert.match(tall,/>1\/2</);assert.match(tall,/aria-label="Próximos clientes"/);
});
