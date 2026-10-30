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
const valuesUrl=dataUrl(`import {moneyLabel} from ${JSON.stringify(sharedUrl)};export const display={visible:true};export const useDashboardValues=()=>({visible:display.visible,money:value=>display.visible?moneyLabel(value):'••••••'});`);
const {display}=await import(valuesUrl);
const page=readFileSync(new URL('../modules/resumo/components/ResumoPage.tsx',import.meta.url),'utf8'),start=page.indexOf('function DashboardMetrics(');
assert.ok(start>=0,'Evaluate the actual contract-metric branch and Metric component');
const iconNames=page.match(/import \{([^}]+)\} from 'lucide-react';/)[1].split(',').map(value=>value.trim());
const source=`import {decimalLabel} from ${JSON.stringify(sharedUrl)};import {useDashboardValues} from ${JSON.stringify(valuesUrl)};const ${iconNames.map(name=>`${name}=()=>null`).join(',')};${page.slice(start)};export {DashboardMetrics};`;
const {DashboardMetrics}=await import(dataUrl(transpile(source).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`)));
const comparison={
 overall:{loadedVolume:'122.028',averageAtr:'135.280393',loadCount:7,contractCount:7},
 types:[
  {code:'1',label:'Manual',loadedVolume:'60.006',averageAtr:'140.603216',loadCount:3,contractCount:3,sharePercent:'49.17'},
  {code:'2',label:'Mecanizada',loadedVolume:'50.009',averageAtr:'150.876543',loadCount:2,contractCount:2,sharePercent:'40.98'},
  {code:'unknown',label:'Não classificado',loadedVolume:'12.013',averageAtr:'116.381238',loadCount:2,contractCount:2,sharePercent:'9.84'},
 ],clients:[],contracts:[],
};
const fixture={totals:{loadedVolume:'1234.567',grossAmount:'',netAmount:'',billingPending:true},operationalTotals:{averageAtr:'999'},comparison:{volumeChangePercent:'88.88'},contractComparison:comparison};
const render=({visible=true,projection=comparison,scene='dashboard-contracts'}={})=>{display.visible=visible;return renderToStaticMarkup(createElement(DashboardMetrics,{scene,data:{...fixture,contractComparison:projection}}));};
const card=(html,marker)=>{const chunk=html.split(`data-dashboard-metric="${marker}"`)[1];assert.ok(chunk,`Expected ${marker} metric`);return chunk.split('data-dashboard-metric=')[0];};
const metricMarkers=html=>[...html.matchAll(/data-dashboard-metric="([^"]+)"/g)].map(match=>match[1]);

test('Contract renders three paired volume and ATR cards directly from the authorized server comparison',()=>{
 const before=structuredClone(comparison),html=render();assert.match(html,/data-metric-count="3"/);assert.equal([...html.matchAll(/<dt>/g)].length,3);
 assert.deepEqual(metricMarkers(html),['loaded-volume','manual-volume','mechanized-volume']);
 for(const [marker,label,volume,atr] of [['loaded-volume','Geral','122,03','135,28'],['manual-volume','Manual','60,01','140,60'],['mechanized-volume','Mecanizada','50,01','150,88']]){
  const output=card(html,marker);assert.ok(output.includes(`<dt><span>${label}</span>`));assert.ok(output.includes(`title="${volume}"`));assert.ok(output.includes(`<span>${volume}</span><small>t</small>`));
  assert.match(output,/class="executive-contract-atr"/);assert.ok(output.includes(`<strong title="${atr}">${atr}<small> kg/t</small></strong>`));
 }
 assert.match(card(html,'loaded-volume'),/7 contrato\(s\)/);assert.match(card(html,'manual-volume'),/3 contrato\(s\)/);
 assert.doesNotMatch(html,/1\.234,57|title="999,00"|88,88%|R\$|Faturamento médio|Recebido no período|executive-metric-change/);
 assert.deepEqual(comparison,before,'Unknown types remain in the authoritative overall figure and no frontend sum or ATR average replaces it');
});

test('financial masking and missing quotations do not hide measured contract volumes or ATR',()=>{
 const shown=render(),hidden=render({visible:false});assert.equal(hidden,shown);
 assert.doesNotMatch(hidden,/••••••/);assert.match(card(hidden,'manual-volume'),/title="140,60"/);assert.match(card(hidden,'mechanized-volume'),/title="150,88"/);
});

test('a missing ATR affects only its supplied group while empty groups retain zero tonnes and an unknown ATR',()=>{
 const pending=structuredClone(comparison);pending.overall.averageAtr='';pending.types[1].averageAtr='';
 const html=render({projection:pending});assert.match(card(html,'loaded-volume'),/<strong title="A apurar">A apurar<\/strong>/);assert.match(card(html,'mechanized-volume'),/<strong title="A apurar">A apurar<\/strong>/);
 assert.match(card(html,'manual-volume'),/<strong title="140,60">/);assert.match(card(html,'mechanized-volume'),/<span>50,01<\/span><small>t<\/small>/);
 const empty={overall:{loadedVolume:'0',averageAtr:'',loadCount:0,contractCount:1},types:comparison.types.map(row=>({...row,loadedVolume:'0',averageAtr:'',loadCount:0,contractCount:row.code==='1'?1:0,sharePercent:'0'})),clients:[],contracts:[]};
 const idle=render({projection:empty});for(const marker of ['loaded-volume','manual-volume','mechanized-volume']){assert.match(card(idle,marker),/<span>0,00<\/span><small>t<\/small>/);assert.match(card(idle,marker),/<strong title="A apurar">A apurar<\/strong>/);}
 assert.doesNotMatch(idle,/NaN|Infinity/);
});

test('an older cached snapshot without the new projection waits for real data instead of substituting operational totals',()=>{
 const html=render({projection:null});assert.match(html,/data-metric-count="3"/);assert.match(html,/Atualizando comparativo dos contratos/);
 for(const marker of ['loaded-volume','manual-volume','mechanized-volume'])assert.match(card(html,marker),/<dd title="A apurar"/);
 assert.doesNotMatch(html,/1\.234,57|title="999,00"|<span>0,00<\/span>/);
});

const plotUrl=dataUrl('export const dimensions={width:600,height:0};export const usePlotSize=()=>({ref:()=>{},size:dimensions});');
const {dimensions}=await import(plotUrl);
const visualUrl=dataUrl(`import {createElement} from ${JSON.stringify(reactUrl)};
 export const observed={bars:null};
 export const DashboardPanel=({title,subtitle,actions,children})=>createElement('section',null,createElement('h3',null,title),createElement('p',null,subtitle),actions,children);
 export const DashboardEmpty=({text,detail})=>createElement('div',null,createElement('strong',null,text),createElement('p',null,detail));
 export const DashboardBars=props=>{observed.bars=props;return createElement('div',null,props.title);};`);
const {observed}=await import(visualUrl);
const linkUrl=dataUrl(`import {createElement} from ${JSON.stringify(reactUrl)};export const ModuleLink=({children,...props})=>createElement('a',props,children);`);
const iconsUrl=dataUrl('export const ArrowUpRight=()=>null,ChevronLeft=()=>null,ChevronRight=()=>null;');
const analysisSource=transpile(readFileSync(new URL('../modules/resumo/components/DashboardContractAnalysis.tsx',import.meta.url),'utf8')+'\nexport {GeneralComparison,ClientComparison,ContractCards};')
 .replace(/from ['"]react['"]/g,`from ${JSON.stringify(reactUrl)}`)
 .replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`)
 .replace(/from ['"]lucide-react['"]/g,`from ${JSON.stringify(iconsUrl)}`)
 .replace(/from ['"]@\/shared\/navigation\/ModuleNavigation['"]/g,`from ${JSON.stringify(linkUrl)}`)
 .replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(sharedUrl)}`)
 .replace(/from ['"]\.\.\/hooks\/usePlotSize['"]/g,`from ${JSON.stringify(plotUrl)}`)
 .replace(/from ['"]\.\/DashboardVisuals['"]/g,`from ${JSON.stringify(visualUrl)}`);
const {GeneralComparison,ClientComparison,ContractCards}=await import(dataUrl(analysisSource));
const client={id:'client-a',name:'CLIENTE COM NOME COMPLETO MUITO LONGO PARA COMPARAÇÃO DOS CONTRATOS MANUAIS E MECANIZADOS',overall:comparison.overall,types:comparison.types};
const otherClient={...client,id:'client-b',name:'Outro cliente com contratos'};
const contract={id:'contract-a',clientName:client.name,contractNumber:'CTR-001',title:'CONTRATO DE ENTREGA COM TÍTULO COMPLETO PARA PRESERVAR A LEITURA',status:'Ativo',loadCount:3,loadedVolume:'60.006',netAmount:'99999.99'};
const otherContract={...contract,id:'contract-b',contractNumber:'CTR-002',clientName:otherClient.name};
const performance={id:contract.id,periodLoadedVolume:'60.006',averageAtr:'140.603216',periodLoadCount:3,totalLoadedVolume:'777.123',contractedVolume:'1000',deliveryPercent:'77.7123'};
const detailData={contracts:[contract,otherContract],contractPerformance:[performance]};
const metadata={...comparison,contracts:[{id:contract.id,clientId:client.id,typeCode:'1',typeName:'MANUAL'},{id:otherContract.id,clientId:otherClient.id,typeCode:'unknown',typeName:'Manual e Mecanizado'}]};
const renderClients=(rows=[client],height=0)=>{dimensions.height=height;return renderToStaticMarkup(createElement(ClientComparison,{rows,presenting:false,slideDurationMs:120000}));};
const renderContracts=(height=0)=>{dimensions.height=height;return renderToStaticMarkup(createElement(ContractCards,{data:detailData,comparison:metadata,presenting:false,slideDurationMs:120000}));};
const matrixRow=(html,code)=>{const match=html.match(new RegExp(`data-comparison-type="${code}"[^>]*>([\\s\\S]*?)<\\/tr>`));assert.ok(match,`Expected comparison row ${code}`);return match[1];};
const matrixCell=(row,marker)=>{
 const match=row.match(new RegExp(`<td\\b[^>]*data-comparison-value="${marker}"[^>]*>([\\s\\S]*?)<\\/td>`));
 assert.ok(match,`Expected comparison cell ${marker}`);return match[1].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
};

test('general and per-client comparisons keep unclassified contracts explicit and preserve every official volume and ATR',()=>{
 const general=renderToStaticMarkup(createElement(GeneralComparison,{comparison}));
 assert.match(general,/Não classificado: 12,01 t · 2 contrato\(s\)/);
 assert.deepEqual(observed.bars.rows.map(row=>row.id),['1','2','unknown']);assert.equal(observed.bars.showAtr,true);assert.equal(observed.bars.showValues,true);
 const html=renderClients();assert.ok(html.includes(`<h4>${client.name}</h4>`));assert.match(html,/data-comparison-client-id="client-a"/);
 for(const [code,label,volume,atr] of [['overall','Geral','122,03','135,28'],['1','Manual','60,01','140,60'],['2','Mecanizada','50,01','150,88'],['unknown','Não classificado','12,01','116,38']]){
  const row=matrixRow(html,code);assert.ok(row.includes(label));assert.equal(matrixCell(row,'volume'),volume);assert.equal(matrixCell(row,'atr'),atr);
 }
 const missing=structuredClone(client);missing.types[1].averageAtr='';missing.overall.averageAtr='';
 const pending=renderClients([missing]);assert.equal(matrixCell(matrixRow(pending,'overall'),'atr'),'A apurar');assert.equal(matrixCell(matrixRow(pending,'2'),'atr'),'A apurar');assert.equal(matrixCell(matrixRow(pending,'1'),'atr'),'140,60');
 const unclassifiedIdle={...client,types:client.types.map(row=>row.code==='unknown'?{...row,loadedVolume:'0',averageAtr:'',loadCount:0,contractCount:1}:row)};
 assert.equal(matrixCell(matrixRow(renderClients([unclassifiedIdle]),'unknown'),'volume'),'0,00','A selected unclassified contract with no current load must remain explicit');
});

test('contract cards separate current period figures from lifetime progress and adapt pagination instead of stacking every contract',()=>{
 const short=renderContracts();assert.match(short,/data-contract-page-size="1"/);assert.equal([...short.matchAll(/data-comparison-contract-id=/g)].length,1);
 assert.ok(short.includes(`<h4>${client.name}</h4>`));assert.ok(short.includes(contract.title));assert.match(short,/Entregas e ATR no período; andamento acumulado em todas as datas/);
 assert.match(short,/data-contract-period="volume"[\s\S]*?title="60,01"/);assert.match(short,/data-contract-period="atr"[\s\S]*?title="140,60"/);
 assert.match(short,/Acumulado \/ contratado/);assert.match(short,/777,12 \/ 1\.000,00 t/);assert.match(short,/77,71%/);assert.match(short,/Página seguinte|Próxima página · Contratos/);
 assert.match(short,/MANUAL/);assert.doesNotMatch(short,/99\.999,99|R\$/);
 const tall=renderContracts(600);assert.match(tall,/data-contract-page-size="2"/);assert.equal([...tall.matchAll(/data-comparison-contract-id=/g)].length,2);assert.match(tall,/Não classificado/);assert.match(tall,/Meta a apurar/);
 const shortClients=renderClients([client,otherClient]);assert.match(shortClients,/data-comparison-page-size="1"/);assert.equal([...shortClients.matchAll(/data-comparison-client-id=/g)].length,1);
 const tallClients=renderClients([client,otherClient],600);assert.match(tallClients,/data-comparison-page-size="2"/);assert.equal([...tallClients.matchAll(/data-comparison-client-id=/g)].length,2);
});
