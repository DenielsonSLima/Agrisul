import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const require=createRequire(import.meta.url),{build}=require(require.resolve('esbuild',{paths:[require.resolve('vite')]})),directory=await mkdtemp(join(tmpdir(),'contract-monthly-period-'));
try{
 const output=join(directory,'period.mjs');
 await build({stdin:{contents:`export * from './modules/contratos/utils/contractMonthlyPeriod'; export * from './modules/contratos/utils/contractDailyLoadsPresentation'; export * from './modules/contratos/utils/contractMonthlyDeliveries'; export * from './modules/contratos/utils/contractMonthlyBalances';`,resolveDir:process.cwd()},outfile:output,bundle:true,platform:'node',format:'esm'});
 const {defaultContractMonthlyPeriod,contractMonthlyPeriodFromDateRange,contractMonthlyDateFilters,contractMonthlyPeriodError,filterContractMonths,defaultContractSummaryPeriod,defaultContractDailyLoadPeriod,contractMonthlyDeliveryRows,contractMonthlyBalanceRows}=await import(pathToFileURL(output));
 assert.deepEqual(defaultContractMonthlyPeriod(new Date(2026,8,28)),{from:'2026-04',to:'2026-09'},'Current month plus the five previous months');
 assert.deepEqual(defaultContractMonthlyPeriod(new Date(2026,0,15)),{from:'2025-08',to:'2026-01'},'Six-month default crosses years');
 assert.deepEqual(contractMonthlyDateFilters({from:'2026-02',to:'2026-02'}),{from:'2026-02-01',to:'2026-02-28'});
 assert.deepEqual(contractMonthlyPeriodFromDateRange({from:'2026-03-28',to:'2026-09-28'}),{from:'2026-03',to:'2026-09'},'Daily dates synchronize the monthly buckets without changing their boundaries');
 assert.equal(contractMonthlyPeriodError({from:'2026-09',to:'2026-08'}),'O mês inicial deve ser igual ou anterior ao mês final.');
 assert.deepEqual(filterContractMonths([{month:'2026-07'},{month:'2026-08'},{month:'2026-09'}],{from:'2026-08',to:'2026-09'}),[{month:'2026-08'},{month:'2026-09'}]);
 const today=new Date(2026,9,29,12);
 assert.deepEqual(defaultContractSummaryPeriod('2026-09-15',today),{from:'2026-09-15',to:'2026-10-29',granularity:'day'});
 assert.deepEqual(defaultContractSummaryPeriod('2026-11-15',today),{from:'2026-11-15',to:'2026-11-15',granularity:'day'},'Future contracts must open with a valid date range');
 assert.deepEqual(defaultContractSummaryPeriod('2025-12-15',new Date(2026,0,2)),{from:'2025-12-15',to:'2026-01-02',granularity:'day'});
 assert.deepEqual(defaultContractDailyLoadPeriod(today),{from:'2026-10-15',to:'2026-10-29',granularity:'day'},'The explicit fifteen-day shortcut retains its meaning');

 // Execute ContractDetail itself: the regression was in its initial state, not the monthly helpers.
 const fixturePath=join(directory,'fixtures.mjs'),fixtures=pathToFileURL(fixturePath).href;
 let source=ts.transpileModule(await readFile('modules/contratos/components/ContractDetail.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const imports=[...source.matchAll(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g)];
 const implementations=new Set(['jsx','jsxs','useState','useRef','useEffect','useCallback','useContracts','useContractLifecycleMutation','useContractDeletionMutation','useConfirmation','useModuleNavigation','useContractLoads','contractHref']);
 const stubs=[...new Set(imports.filter(([, ,path])=>!path.endsWith('/contractMonthlyPeriod')&&!path.endsWith('/contractDailyLoadsPresentation')).flatMap(([,names])=>names.split(',').map(name=>name.trim().split(/\s+as\s+/)[0])))].filter(name=>!implementations.has(name));
 await writeFile(fixturePath,`
  export const state={slots:[],cursor:0,contract:null};
  export const jsx=(type,props)=>({type,props}),jsxs=jsx;
  export function useState(initial){const index=state.cursor++;if(!(index in state.slots))state.slots[index]=typeof initial==='function'?initial():initial;return [state.slots[index],value=>{state.slots[index]=typeof value==='function'?value(state.slots[index]):value;}];}
  export const useRef=value=>useState(()=>({current:value}))[0],useEffect=()=>{},useCallback=callback=>callback;
  export const useContracts=()=>({contract:state.contract,loading:!state.contract,error:''});
  export const useContractLifecycleMutation=()=>({isPending:false}),useContractDeletionMutation=useContractLifecycleMutation;
  export const useConfirmation=()=>()=>false;
  export const useModuleNavigation=()=>({searchParams:new URLSearchParams(),navigate:()=>{}});
  export const useContractLoads=()=>({loading:false,error:'',data:null});
  export const contractHref=id=>'/contratos?id='+id;
  ${stubs.map(name=>`export const ${name}=${JSON.stringify(name)};`).join('\n')}
 `);
 source=source.replace(/import\s+["'][^"']+["'];?/g,'').replace(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g,(_,names,path)=>`import {${names}} from ${JSON.stringify(path.endsWith('/contractMonthlyPeriod')||path.endsWith('/contractDailyLoadsPresentation')?pathToFileURL(output).href:fixtures)};`);
 const detailPath=join(directory,'detail.mjs');await writeFile(detailPath,source);
 const {state}=await import(fixtures),{ContractDetail}=await import(pathToFileURL(detailPath));
 const find=(node,predicate)=>Array.isArray(node)?node.map(item=>find(item,predicate)).find(Boolean):node&&typeof node==='object'?(predicate(node)?node:find(node.props?.children,predicate)):undefined;
 const render=()=>{state.cursor=0;return ContractDetail({id:state.contract?.id??'contract-a',editing:false,saved:false});};
 const NativeDate=globalThis.Date;
 globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[today.getTime()]));}};
 try{
  assert.equal(find(render(),node=>node.type==='ContractSummaryTab'),undefined,'Loading must not persist the recent-days fallback');
  const septemberFinance={month:'2026-09',loadedVolume:'469.76',averageAtr:'127.650403',grossAmount:'76659.32',discountAmount:'0',netAmount:'76659.32',billingPending:false};
  state.contract={id:'contract-a',startDate:'2026-09-15',notes:'',status:'Ativo',monthlySummary:{months:[{month:'2026-09',loadedVolume:'469.76',atrQuote:'1.2784'}]},financialSummary:{months:[septemberFinance,{...septemberFinance,month:'2026-10',loadedVolume:'0',grossAmount:'0',netAmount:'0'}],payments:[],refunds:[],discounts:[]}};
  let tree=render(),summary=find(tree,node=>node.type==='ContractSummaryTab').props;
  assert.deepEqual(summary.dailyPeriod,{from:'2026-09-15',to:'2026-10-29',granularity:'day'});
  assert.deepEqual(summary.monthlyPeriod,{from:'2026-09',to:'2026-10'});
  const loads=[{loadedAt:'2026-09-15',volume:'182.78'},{loadedAt:'2026-09-16',volume:'286.98'}];
  const deliveries=contractMonthlyDeliveryRows(state.contract,{groups:[{key:'2026-09',loads}]},summary.monthlyPeriod);
  assert.deepEqual(deliveries.map(row=>row.month),['2026-09','2026-10']);
  assert.equal(deliveries[0].loads.length,2);assert.equal(deliveries[0].loadedVolume,'469.76');assert.equal(deliveries[0].netAmount,'76659.32');
  assert.equal(contractMonthlyBalanceRows(state.contract,summary.monthlyPeriod)[0].finance,septemberFinance,'Balances preserve the September snapshot supplied by the RPC');
  find(tree,node=>node.props?.title==='Exportar resumo do contrato').props.onClick();
  const report=find(render(),node=>node.type==='ContractMonthlyReportDialog').props;
  assert.deepEqual(report.period,summary.monthlyPeriod);assert.deepEqual(report.dailyPeriod,summary.dailyPeriod,'PDF shares the full initial interval');
  const manual={from:'2026-10-02',to:'2026-10-20',granularity:'week'};
  summary.onDailyPeriod(manual);state.contract={...state.contract,notes:'Refetched data'};
  summary=find(render(),node=>node.type==='ContractSummaryTab').props;
  assert.deepEqual(summary.dailyPeriod,manual,'Refetch preserves the user selection');
  assert.deepEqual(summary.monthlyPeriod,{from:'2026-10',to:'2026-10'},'Manual filtering still synchronizes monthly tables');
  state.contract={...state.contract,startDate:'2026-08-10'};
  assert.equal(find(render(),node=>node.type==='ContractSummaryTab').props.dailyPeriod.from,'2026-08-10','Changing the contract start takes effect immediately');
  state.contract={...state.contract,id:'contract-b',startDate:'2026-11-15'};
  assert.deepEqual(find(render(),node=>node.type==='ContractSummaryTab').props.dailyPeriod,{from:'2026-11-15',to:'2026-11-15',granularity:'day'},'Another contract cannot inherit the previous selection');
 }finally{globalThis.Date=NativeDate;}
 console.log('Passed: contract-start summary period, September deliveries/balances, shared PDF range, loading/refetch/navigation, future dates and fifteen-day shortcut.');
}finally{await rm(directory,{recursive:true,force:true});}
