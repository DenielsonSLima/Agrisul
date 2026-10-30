import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {parseAgriculturalXml,parseAgriculturalWorkbook} from '../supabase/functions/dashboard-market-refresh/agriculture.mjs';

test('Edge agricultural reader preserves source columns, sparse cells, inline/rich strings, regions and newest publications without assuming row order',()=>{
 const strings='<sst><si><t>outubro</t></si><si><r><t>Soja industrial</t></r><r><t> - sc 60 kg</t></r></si><si><t>Oeste</t></si><si><t>Arroz irrigado em casca - sc 50 kg</t></si><si><t>Litoral Sul</t></si></sst>';
 const row=(day,product,place,price)=>`<row><c r="A1"><v>2026</v></c><c r="B1" t="s"><v>0</v></c><c r="C1"><v>${day}</v></c><c r="D1" t="s"><v>${product}</v></c><c r="E1" t="s"><v>${place}</v></c><c r="F1"><v>1</v></c><c r="G1"><v>${price}</v></c><c r="H1"><v>999</v></c></row>`;
 const inline='<row><c r="C9"><v>25</v></c><c t="inlineStr" r="D9"><is><t>Milho-amarelo - sc 60 kg</t></is></c><c r="A9"><v>2026</v></c><c r="B9" t="inlineStr"><is><t>outubro</t></is></c><c r="E9" t="inlineStr"><is><t>Oeste</t></is></c><c r="G9"><v>54.5</v></c></row>';
 const missing='<row><c r="A10"><v>2026</v></c><c r="B10" t="s"><v>0</v></c><c r="C10"><v>26</v></c><c r="D10" t="s"><v>1</v></c><c r="E10" t="s"><v>2</v></c><c r="G10"/></row>';
 const quotes=parseAgriculturalXml(strings,[`<sheetData>${row(22,1,2,134)}${row(20,1,2,120)}${row(23,1,4,999)}${row(9,3,4,76)}${row(22,3,2,999)}${inline}${missing}</sheetData>`]);
 assert.equal(quotes.find(q=>q.id==='soy').value,'134');assert.equal(quotes.find(q=>q.id==='soy').date,'2026-10-22');
 assert.equal(quotes.find(q=>q.id==='rice').value,'76');assert.equal(quotes.find(q=>q.id==='rice').date,'2026-10-09');
 assert.equal(quotes.find(q=>q.id==='corn').value,'54.5');assert.equal(quotes.find(q=>q.id==='corn').date,'2026-10-25');
 assert.equal(quotes.find(q=>q.id==='beans').value,null);
});
test('Edge XLSX reader bounds decompression and rejects archives with no worksheets',()=>{
 assert.throws(()=>parseAgriculturalWorkbook(new Uint8Array(),{unzipSync(_bytes,{filter}){filter({name:'xl/worksheets/sheet1.xml',originalSize:80_000_001});},strFromU8(){}}),/limite/);
 assert.throws(()=>parseAgriculturalWorkbook(new Uint8Array(),{unzipSync(){return {};},strFromU8(){}}),/sem dados/);
});

const uri=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const fixtureUrl=uri(`
 export const state={calls:[],feeds:[],fail:false,token:'lease-a'};
 export function createClient(){return {rpc(_name,args){state.calls.push(args);return {abortSignal:async()=>({data:args.p_action==='claim'?{token:state.token}:{updated:true},error:null})};}};}
 export async function getMarketFeed(group){state.feeds.push(group);if(state.fail)throw Error('provider down');return {quotes:[{id:'usd',status:'available'}]};}
 export const getAgriculturalFeed=()=>getMarketFeed('agriculture'),unzipSync=()=>{},strFromU8=()=>{};
`);
const {state}=await import(fixtureUrl);
const previousDeno=globalThis.Deno;let handle;
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://ykounjabfsrtkzostbbz.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only-fixture',DASHBOARD_MARKET_REFRESH_TOKEN:'scoped-test-token'})[key]},serve:callback=>{handle=callback;}};
try{
 const source=ts.transpileModule(await readFile(new URL('../supabase/functions/dashboard-market-refresh/index.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from ['"][^'"]+['"]/g,`from ${JSON.stringify(fixtureUrl)}`);
 await import(uri(source));
}finally{globalThis.Deno=previousDeno;}
const request=(body={group:'currency'},token='scoped-test-token')=>new Request('https://example.test/worker',{method:'POST',headers:{'Content-Type':'application/json','x-market-refresh-token':token},body:JSON.stringify(body)});
test('scheduled worker rejects unsigned calls and invalid groups before any provider or privileged RPC',async()=>{
 state.calls=[];state.feeds=[];
 assert.equal((await handle(request({group:'currency'},''))).status,401);
 assert.equal((await handle(request({group:'currency'},'wrong'))).status,401);
 assert.equal((await handle(request({group:'__proto__'}))).status,400);
 assert.equal((await handle(request({group:'currency',ownerId:'other'}))).status,400);
 assert.deepEqual(state.calls,[]);assert.deepEqual(state.feeds,[]);
});
test('worker claims once, collects only its requested group and commits results; a held lease skips external traffic',async()=>{
 state.calls=[];state.feeds=[];state.token='lease-a';state.fail=false;
 assert.equal((await handle(request())).status,200);assert.deepEqual(state.feeds,['currency']);
 assert.deepEqual(state.calls.map(call=>call.p_action),['claim','finish']);assert.equal(state.calls[1].p_payload.token,'lease-a');
 state.calls=[];state.feeds=[];state.token=null;
 assert.equal((await handle(request())).status,200);assert.deepEqual(state.feeds,[]);assert.deepEqual(state.calls.map(call=>call.p_action),['claim']);
});
test('provider failure records a failed refresh without fabricated prices, so Postgres can preserve the last good publication',async()=>{
 state.calls=[];state.feeds=[];state.token='lease-b';state.fail=true;
 assert.equal((await handle(request({group:'agriculture'}))).status,503);assert.deepEqual(state.feeds,['agriculture']);
 assert.equal(state.calls[1].p_payload.token,'lease-b');assert.deepEqual(state.calls[1].p_payload.quotes,[]);assert.match(state.calls[1].p_payload.error,/preservada/);
});
