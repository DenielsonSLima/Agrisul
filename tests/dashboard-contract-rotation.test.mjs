import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
// Exercise the actual parent component with deterministic hooks and a virtual
// clock. Child elements remain VNodes so their pagination timers cannot obscure
// the timer responsible for switching between the three contract views.
const fixtures=dataUrl(`
 export const state={slots:[],cursor:0,effects:[],pending:[],timers:new Map(),cleared:[],nextTimer:1,now:0,focused:[]};
 export function useState(initial){const index=state.cursor++;if(!(index in state.slots))state.slots[index]=typeof initial==='function'?initial():initial;return [state.slots[index],value=>{state.slots[index]=typeof value==='function'?value(state.slots[index]):value;}];}
 export function useId(){state.cursor++;return 'contract-analysis';}
 export function useEffect(effect,deps){const index=state.cursor++,previous=state.effects[index];if(!previous||deps.length!==previous.deps.length||deps.some((value,i)=>!Object.is(value,previous.deps[i])))state.pending.push(()=>{previous?.cleanup?.();const cleanup=effect();state.effects[index]={deps,cleanup};});}
 export const jsx=(type,props,key)=>({type,props:props??{},key}),jsxs=jsx,Fragment=Symbol('Fragment');
 export const ArrowUpRight=()=>null,ChevronLeft=()=>null,ChevronRight=()=>null,ModuleLink=()=>null;
 export const decimalLabel=value=>String(value??'A apurar');
 export const usePlotSize=()=>({ref:()=>{},size:{width:0,height:0}});
 export const DashboardBars=()=>null,DashboardEmpty=()=>null,DashboardPanel=()=>null;
`);
const {state,DashboardBars}=await import(fixtures);
const source=ts.transpileModule(readFileSync(new URL('../modules/resumo/components/DashboardContractAnalysis.tsx',import.meta.url),'utf8')+'\nexport {GeneralComparison};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 .replace(/from ['"](?:react|react\/jsx-runtime|lucide-react|@\/shared\/navigation\/ModuleNavigation|@\/shared\/utils\/presentation|\.\.\/hooks\/usePlotSize|\.\/DashboardVisuals)['"]/g,`from ${JSON.stringify(fixtures)}`);
const {DashboardContractAnalysis,GeneralComparison}=await import(dataUrl(source));
const data={contractComparison:{overall:{loadedVolume:'0',averageAtr:'',loadCount:0,contractCount:0},types:[],clients:[],contracts:[]},contracts:[],contractPerformance:[]};
function findNode(node,predicate){
 if(!node)return undefined;
 if(Array.isArray(node)){for(const child of node){const found=findNode(child,predicate);if(found)return found;}return undefined;}
 if(typeof node!=='object')return undefined;
 return predicate(node)?node:findNode(node.props?.children,predicate);
}
function setup(initial={}){
 const previous={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 state.slots=[];state.cursor=0;state.effects=[];state.pending=[];state.timers.clear();state.cleared=[];state.nextTimer=1;state.now=0;state.focused=[];
 let props={data,presenting:false,slideDurationMs:60000,...initial},tree;
 const schedule=(callback,delay)=>{const id=state.nextTimer++;state.timers.set(id,{callback,delay,due:state.now+delay});return id;};
 const clear=id=>{state.cleared.push(id);state.timers.delete(id);};
 globalThis.window={setTimeout:schedule,clearTimeout:clear};globalThis.setTimeout=schedule;globalThis.clearTimeout=clear;
 globalThis.document={getElementById:id=>({focus:()=>state.focused.push(id)})};
 const render=updates=>{
  props={...props,...updates};state.cursor=0;state.pending=[];tree=DashboardContractAnalysis(props);
  for(const effect of state.pending)effect();return tree;
 };
 const region=()=>findNode(tree,node=>node.props?.className==='dashboard-contract-view');
 const view=()=>{const node=region();assert.ok(node,'The contract view region must be mounted');return node.props['data-view'];};
 const child=()=>region().props.children;
 const timer=()=>{assert.equal(state.timers.size,1,'Exactly one parent view timer is active');return [...state.timers.entries()][0];};
 const elapse=milliseconds=>{
  const target=state.now+milliseconds;
  for(let iterations=0;iterations<100;iterations++){
   const next=[...state.timers.entries()].sort((a,b)=>a[1].due-b[1].due)[0];
   if(!next||next[1].due>target){state.now=target;return;}
   state.now=next[1].due;state.timers.delete(next[0]);next[1].callback();render();
  }
  throw Error('Unexpected repeating timer loop');
 };
 const select=label=>{
  const button=findNode(tree,node=>node.type==='button'&&node.props.children===label);
  assert.ok(button,`Expected the ${label} view selector`);button.props.onClick();render();
 };
 const unmount=()=>{for(const effect of state.effects)effect?.cleanup?.();state.effects=[];};
 render();
 return {render,view,child,timer,elapse,select,unmount,restore:()=>{unmount();Object.assign(globalThis,previous);}};
}

for(const [minutes,duration] of [[1,60000],[2,120000],[5,300000]])test(`${minutes}-minute Contract scenes allocate exactly one third to each view and each child pagination budget`,()=>{
 const fixture=setup({presenting:true,slideDurationMs:duration}),budget=duration/3;
 try{
  assert.equal(fixture.view(),'general');assert.equal(fixture.timer()[1].delay,budget);assert.equal(fixture.child().props.presenting,true);assert.equal(fixture.child().props.slideDurationMs,budget);
  fixture.elapse(budget-1);assert.equal(fixture.view(),'general');fixture.elapse(1);assert.equal(fixture.view(),'clients');
  assert.equal(fixture.child().props.presenting,true);assert.equal(fixture.child().props.slideDurationMs,budget);assert.equal(fixture.timer()[1].delay,budget);
  fixture.elapse(budget);assert.equal(fixture.view(),'contracts');assert.equal(fixture.child().props.slideDurationMs,budget);assert.equal(fixture.timer()[1].delay,budget);
  fixture.elapse(budget);assert.equal(fixture.view(),'general');assert.equal(state.now,duration);assert.equal(state.timers.size,1);
 }finally{fixture.restore();}
});

test('the General comparison forwards its own time budget and pause state to automatic chart pagination',()=>{
 for(const presenting of [true,false]){
  const tree=GeneralComparison({comparison:data.contractComparison,presenting,slideDurationMs:20000});
  const chart=findNode(tree,node=>node.type===DashboardBars);assert.ok(chart);
  assert.equal(chart.props.presenting,presenting);assert.equal(chart.props.slideDurationMs,20000);
 }
});

test('ordinary browsing never schedules automatic rotation, including after manual view selection',()=>{
 const fixture=setup();
 try{
  assert.equal(state.timers.size,0);assert.equal(fixture.child().props.presenting,false);fixture.select('Por cliente');assert.equal(fixture.view(),'clients');assert.equal(fixture.child().props.presenting,false);
  fixture.elapse(300000);assert.equal(fixture.view(),'clients');assert.equal(state.timers.size,0);
 }finally{fixture.restore();}
});

test('pausing clears the active timer and resuming starts a fresh budget for the current view',()=>{
 const fixture=setup({presenting:true});
 try{
  fixture.select('Por cliente');fixture.elapse(5000);const previous=fixture.timer()[0];
  fixture.render({presenting:false});assert.equal(state.timers.size,0);assert.ok(state.cleared.includes(previous));assert.equal(fixture.child().props.presenting,false);
  fixture.elapse(60000);assert.equal(fixture.view(),'clients');
  fixture.render({presenting:true});assert.equal(fixture.timer()[1].delay,20000);
  fixture.elapse(19999);assert.equal(fixture.view(),'clients');fixture.elapse(1);assert.equal(fixture.view(),'contracts');
 }finally{fixture.restore();}
});

test('manual navigation cancels the old timeout and gives the selected view its full interval',()=>{
 const fixture=setup({presenting:true});
 try{
  const previous=fixture.timer()[0];fixture.elapse(10000);fixture.select('Por cliente');
  assert.equal(fixture.view(),'clients');assert.ok(state.cleared.includes(previous));assert.notEqual(fixture.timer()[0],previous);assert.equal(fixture.timer()[1].due,30000);
  fixture.elapse(10000);assert.equal(fixture.view(),'clients','The cancelled General timeout cannot switch the new view early');
  fixture.elapse(9999);assert.equal(fixture.view(),'clients');fixture.elapse(1);assert.equal(fixture.view(),'contracts');
 }finally{fixture.restore();}
});

test('changing the scene duration cancels the old timeout and updates both rotation and child pagination budgets',()=>{
 const fixture=setup({presenting:true,slideDurationMs:120000});
 try{
  fixture.select('Por cliente');fixture.elapse(10000);const previous=fixture.timer()[0];
  fixture.render({slideDurationMs:300000});assert.ok(state.cleared.includes(previous));assert.equal(fixture.timer()[1].delay,100000);assert.equal(fixture.child().props.slideDurationMs,100000);
  fixture.elapse(30000);assert.equal(fixture.view(),'clients');fixture.elapse(69999);assert.equal(fixture.view(),'clients');fixture.elapse(1);assert.equal(fixture.view(),'contracts');
 }finally{fixture.restore();}
});

test('unmounting the Contract scene clears its pending rotation without advancing a detached component',()=>{
 const fixture=setup({presenting:true});
 try{
  const previous=fixture.timer()[0],view=fixture.view();fixture.unmount();assert.equal(state.timers.size,0);assert.ok(state.cleared.includes(previous));
  fixture.elapse(60000);assert.equal(fixture.view(),view);assert.equal(state.timers.size,0);
 }finally{fixture.restore();}
});
