import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const source=ts.transpileModule(readFileSync(new URL('../modules/importacoes/utils/columnSelection.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {resolveColumnType,visibleImportSelection,toggleVisibleImportSelection}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('type picker opens with the actual numeric/date/text column type',()=>{
 assert.equal(resolveColumnType({key:'A',type:'decimal'},null),'decimal');assert.equal(resolveColumnType({key:'B',type:'date'},null),'date');assert.equal(resolveColumnType({key:'C',type:'text'},null),'text');
});
test('explicit type choice survives refetches while switching columns or a remote type change uses the current field',()=>{
 const draft={key:'A',sourceType:'decimal',value:'text'};assert.equal(resolveColumnType({key:'A',type:'decimal'},draft),'text');
 assert.equal(resolveColumnType({key:'B',type:'date'},draft),'date');assert.equal(resolveColumnType({key:'A',type:'date'},draft),'date');
});

test('write selection contains only visible IDs in table order without discarding hidden selections',()=>{
 const selected=['hidden','b','a','b'];const before=[...selected];
 assert.deepEqual(visibleImportSelection([{id:'a'},{id:'other'},{id:'b'},{id:'a'}],selected),['a','b']);
 assert.deepEqual(visibleImportSelection([{id:'b'}],selected),['b']);
 assert.deepEqual(visibleImportSelection([],selected),[]);
 assert.deepEqual(selected,before,'Building a visible write selection never mutates the complete selection');
});

test('selecting all filtered rows preserves hidden IDs and deduplicates both stored and visible IDs',()=>{
 const selected=['hidden','b','hidden'];const entries=[{id:'a'},{id:'b'},{id:'a'},{id:'c'}];
 assert.deepEqual(toggleVisibleImportSelection(selected,entries,true),['hidden','b','a','c']);
 assert.deepEqual(selected,['hidden','b','hidden']);assert.deepEqual(entries,[{id:'a'},{id:'b'},{id:'a'},{id:'c'}]);
 assert.deepEqual(toggleVisibleImportSelection(['hidden','hidden'],[],true),['hidden']);
});

test('clearing selected filtered rows removes only visible IDs and retains the hidden selection',()=>{
 const selected=['hidden','a','b','hidden'];const visible=[{id:'a'},{id:'b'},{id:'a'}];
 assert.deepEqual(toggleVisibleImportSelection(selected,visible,false),['hidden']);
 const preserved=toggleVisibleImportSelection(['hidden','a'],[{id:'a'}],false);
 assert.deepEqual(visibleImportSelection([{id:'hidden'},{id:'a'}],preserved),['hidden'],'A selection hidden by filtering reappears when its row becomes visible');
 assert.deepEqual(toggleVisibleImportSelection(['hidden','hidden'],[],false),['hidden']);
});

// Exercise the actual table handlers, including their write payload and preview,
// with deterministic hook state and an isolated mutation adapter.
const dataUrl=value=>'data:text/javascript;base64,'+Buffer.from(value).toString('base64');
const fixtureUrl=dataUrl(`
export const state={slots:[],cursor:0,calls:[],entryCalls:[],confirmations:[]};
export function useState(initial){const index=state.cursor++;if(!(index in state.slots))state.slots[index]=typeof initial==='function'?initial():initial;return [state.slots[index],next=>{state.slots[index]=typeof next==='function'?next(state.slots[index]):next;}];}
export const useRef=value=>({current:value}),useMounted=()=>({current:true});
export const useImportMutations=()=>({saving:false,saveBulk:async payload=>{state.calls.push(payload);},saveEntry:async payload=>{state.entryCalls.push(payload);}});
export const useConfirmation=()=>async options=>{state.confirmations.push(options);return true;};
export const notifications={updated(){}},message=String,dateLabel=String;
export const Field='label',CalendarDays='i',Pencil='i',Loader2='i',Check='i',Trash2='i',FileText='i',Settings2='i',EntrySourceNotes='div',ImportColumnFilter='i',ImportEditableCell='i';
`);
const fixture=await import(fixtureUrl);
const compile=(value,jsx=false)=>ts.transpileModule(value,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:jsx?ts.JsxEmit.ReactJSX:undefined}}).outputText;
const presentationUrl=dataUrl(compile(readFileSync(new URL('../modules/importacoes/utils/presentation.ts',import.meta.url),'utf8')).replace(/from ['"]@\/shared\/utils\/presentation['"]/g,`from ${JSON.stringify(fixtureUrl)}`));
const tableFile=readFileSync(new URL('../modules/importacoes/components/ImportacoesPage.tsx',import.meta.url),'utf8');
const internalAtrSource=tableFile.match(/^const INTERNAL_ATR_FIELD:ImportField=.*$/m)?.[0];
assert.ok(internalAtrSource);
const tableStart=tableFile.indexOf('function ImportDayTable('),tableEnd=tableFile.indexOf('\nfunction EntryEditor(',tableStart);
assert.ok(tableStart>=0&&tableEnd>tableStart);
const tableSource=`import {useState,useRef,useMounted,useImportMutations,useConfirmation,notifications,message,dateLabel,Field,CalendarDays,Pencil,Loader2,Check,Trash2,FileText,Settings2,EntrySourceNotes,ImportColumnFilter,ImportEditableCell} from ${JSON.stringify(fixtureUrl)};
import {resolveColumnType,visibleImportSelection,toggleVisibleImportSelection} from ${JSON.stringify(dataUrl(source))};
import {MAIN_IMPORT_COLUMNS,mainImportFields,importFieldLabel,importCount,importGroupDecoration} from ${JSON.stringify(presentationUrl)};
import {importValueFields} from ${JSON.stringify(dataUrl(compile(readFileSync(new URL('../modules/importacoes/utils/equipmentFields.ts',import.meta.url),'utf8'))))};
const typeLabel={text:'Texto',decimal:'Número',date:'Data'},entrySequenceHelp='Entradas por conjunto';
${internalAtrSource}
export ${tableFile.slice(tableStart,tableEnd)}`;
const jsxUrl=pathToFileURL(createRequire(import.meta.url).resolve('react/jsx-runtime')).href;
const {ImportDayTable}=await import(dataUrl(compile(tableSource,true).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`)));
function elements(node,predicate){if(Array.isArray(node))return node.flatMap(child=>elements(child,predicate));if(!node||typeof node!=='object'||!node.props)return [];return [...(predicate(node)?[node]:[]),...elements(node.props.children,predicate)];}
function tableFixture(){
 fixture.state.slots=[];fixture.state.cursor=0;fixture.state.calls=[];fixture.state.entryCalls=[];fixture.state.confirmations=[];
 const fields=[['COD_ENTRADA','L'],['COD_FAZENDA','F'],['COD_TALHAO','H'],['COD_TIPOCOLHEITA','K'],['COD_EQUIPAMENTO_TRANSPORTE','S'],['COD_EQUIPAMENTO_COMPARTIMENTO','Y']].map(([key,column])=>({key,column,label:key,type:'decimal',source:'manual',required:true}));
 const entries=Array.from({length:9},(_,index)=>({id:`row-${index+1}`,date:'2026-10-29',values:{COD_TALHAO:'21'},reviewed:false}));
 const props={date:'2026-10-29',document:{id:'document',profileSnapshot:{fields,parser:'pinheiro-usjp-v1'},updatedAt:'revision'},entries,editable:true,onEdit(){},onRemove(){}};
 return {props,render(){fixture.state.cursor=0;return ImportDayTable(props);}};
}
const checkbox=(tree,row)=>elements(tree,node=>node.type==='input'&&String(node.props['aria-label']).startsWith(`Selecionar linha ${row} de `))[0];
const column=(tree,key)=>elements(tree,node=>node.props.className==='imports-column-select'&&String(node.props['aria-label']).includes(key))[0];
const applyButton=tree=>elements(tree,node=>node.props['aria-label']==='Aplicar valor nas linhas selecionadas')[0];
function fillValue(tree,value){elements(tree,node=>node.type==='input'&&node.props.maxLength===1000)[0].props.onChange({target:{value}});}

test('checking three rows then clicking a column preserves exactly those rows in highlight, confirmation and write payload',async()=>{
 const table=tableFixture();for(const row of [1,2,3])checkbox(table.render(),row).props.onChange();
 column(table.render(),'COD_TALHAO').props.onClick();fillValue(table.render(),'3');const tree=table.render();
 const selected=elements(tree,node=>node.type==='td'&&node.props['data-selected']);assert.equal(selected.length,3);
 applyButton(tree).props.onClick();await new Promise(setImmediate);
 assert.deepEqual(fixture.state.calls,[{id:'document',entryIds:['row-1','row-2','row-3'],fieldKeys:['COD_TALHAO'],value:'3',expectedUpdatedAt:'revision'}]);
 assert.match(fixture.state.confirmations[0].description,/3 linha\(s\) e 1 coluna\(s\)/);
});
test('select-all checkbox targets all visible rows of the current column without selecting every field',async()=>{
 const table=tableFixture();column(table.render(),'COD_TALHAO').props.onClick();
 elements(table.render(),node=>node.type==='input'&&String(node.props['aria-label']).startsWith('Selecionar todas as linhas'))[0].props.onChange({target:{checked:true}});
 fillValue(table.render(),'4');applyButton(table.render()).props.onClick();await new Promise(setImmediate);
 assert.deepEqual(fixture.state.calls[0].fieldKeys,['COD_TALHAO']);assert.deepEqual(fixture.state.calls[0].entryIds,table.props.entries.map(entry=>entry.id));
});
test('a hidden selection never falls back to all rows when choosing another column',async()=>{
 const table=tableFixture();checkbox(table.render(),1).props.onChange();table.props.entries=table.props.entries.slice(3);
 column(table.render(),'COD_TALHAO').props.onClick();const tree=table.render();assert.equal(applyButton(tree).props.disabled,true);applyButton(tree).props.onClick();await new Promise(setImmediate);assert.deepEqual(fixture.state.calls,[]);
 checkbox(table.render(),2).props.onChange();column(table.render(),'COD_FAZENDA').props.onClick();fillValue(table.render(),'5030');applyButton(table.render()).props.onClick();await new Promise(setImmediate);
 assert.deepEqual(fixture.state.calls[0].entryIds,['row-5']);assert.deepEqual(fixture.state.calls[0].fieldKeys,['COD_FAZENDA']);
});
test('editing either equipment column previews and sends both fields, limited to checked rows',async()=>{
 for(const key of ['COD_EQUIPAMENTO_TRANSPORTE','COD_EQUIPAMENTO_COMPARTIMENTO']){
  const table=tableFixture();for(const row of [1,3])checkbox(table.render(),row).props.onChange();column(table.render(),key).props.onClick();fillValue(table.render(),'141');const tree=table.render();
  assert.equal(elements(tree,node=>node.type==='td'&&node.props['data-selected']).length,4);
  applyButton(tree).props.onClick();await new Promise(setImmediate);
  assert.deepEqual(fixture.state.calls[0].entryIds,['row-1','row-3']);assert.deepEqual(new Set(fixture.state.calls[0].fieldKeys),new Set(['COD_EQUIPAMENTO_TRANSPORTE','COD_EQUIPAMENTO_COMPARTIMENTO']));assert.equal(fixture.state.calls[0].value,'141');
  assert.match(fixture.state.confirmations[0].description,/2 linha\(s\) e 2 coluna\(s\)/);
 }
});
test('direct equipment-cell saves mirror both fields only in that cell row',async()=>{
 const table=tableFixture();const cell=elements(table.render(),node=>node.props.entryId==='row-2'&&node.props.field?.key==='COD_EQUIPAMENTO_COMPARTIMENTO')[0];
 await cell.props.onSave('142','revision');assert.deepEqual(fixture.state.calls[0].entryIds,['row-2']);assert.deepEqual(new Set(fixture.state.calls[0].fieldKeys),new Set(['COD_EQUIPAMENTO_TRANSPORTE','COD_EQUIPAMENTO_COMPARTIMENTO']));
});
test('the entry form immediately repeats S/Y changes in the other input and submits both values',async()=>{
 const end=tableFile.indexOf('\nfunction ',tableEnd+1),formSource=tableSource.slice(0,tableSource.indexOf('export function ImportDayTable'))+'export '+tableFile.slice(tableEnd+1,end);
 const {EntryEditor}=await import(dataUrl(compile(formSource,true).replace(/from ['"]react\/jsx-runtime['"]/g,`from ${JSON.stringify(jsxUrl)}`)));
 const table=tableFixture(),entry=table.props.entries[0],before=structuredClone(entry);
 const render=()=>{fixture.state.cursor=0;return EntryEditor({document:table.props.document,entry,onClose(){}});};
 const input=(tree,column)=>elements(elements(tree,node=>String(node.props.label).includes('Excel '+column))[0],node=>node.type==='input'&&node.props.maxLength===1000)[0];
 input(render(),'S').props.onChange({target:{value:'141'}});assert.equal(input(render(),'Y').props.value,'141');
 input(render(),'Y').props.onChange({target:{value:'142'}});assert.equal(input(render(),'S').props.value,'142');
 elements(render(),node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});await new Promise(setImmediate);
 assert.equal(fixture.state.entryCalls[0].values.COD_EQUIPAMENTO_TRANSPORTE,'142');assert.equal(fixture.state.entryCalls[0].values.COD_EQUIPAMENTO_COMPARTIMENTO,'142');assert.deepEqual(entry,before);
});
