import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('inline and form harvest orders spread to the same farm and plot across days, never other documents',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const field=(key,column,type='text')=>({key,column,type,label:key,source:'manual',sourceKey:'',required:false,defaultValue:'',mappings:{},pattern:''});
 const fields=[field('COD_FAZENDA','F'),field('COD_TALHAO','H'),field('NR_ORDEM_COLHEITA','AC','decimal'),field('PESOBRUTO','AA','decimal')];
 try{
  const profile=(await rpc('import-profiles','save',{name:'Ordem automática na célula',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields})).profile;
  const entries=Array.from({length:14},(_,i)=>({date:i%2?'2026-10-30':'2026-10-29',source:{original:String(i)},sourcePage:1,sourceLine:`Original ${i}`,values:{COD_FAZENDA:i===10?'5035':i>11?'':'5032',COD_TALHAO:i===11?'63':i%2?'062':'62',NR_ORDEM_COLHEITA:String(i+1),PESOBRUTO:'25.1'}}));
  const input={profileId:profile.id,clientId:ids.partner,sourceName:'ordens.pdf',sourceHash:'f'.repeat(64),entries};
  let document=(await docs('import',input)).document;
  const other=(await docs('import',{...input,sourceHash:'a'.repeat(64)})).document;
  const initial=structuredClone(document);
  const row=i=>document.entries.find(e=>e.source.original===String(i));
  const targetRows=()=>document.entries.filter(e=>Number(e.source.original)<10);
  const bulk=async(value,index=0)=>{document=(await docs('save-bulk',{id:document.id,entryIds:[row(index).id],fieldKey:'NR_ORDEM_COLHEITA',value,expectedUpdatedAt:document.updatedAt})).document;};
  await bulk('160');assert.deepEqual(targetRows().map(e=>e.values.NR_ORDEM_COLHEITA),Array(10).fill('160'));
  assert.deepEqual(Array.from({length:4},(_,i)=>row(i+10)).map(e=>e.values.NR_ORDEM_COLHEITA),['11','12','13','14']);
  assert.deepEqual((await docs('table',{id:document.id,date:'2026-10-30'})).entries.slice(0,5).map(e=>e.values.NR_ORDEM_COLHEITA),Array(5).fill('160'),'Includes rows outside the day filter');
  await bulk('');assert.deepEqual(targetRows().map(e=>e.values.NR_ORDEM_COLHEITA),Array(10).fill(''));
  const edited=row(3);document=(await docs('save-entry',{id:document.id,entryId:edited.id,date:edited.date,values:{...edited.values,NR_ORDEM_COLHEITA:'161'},reviewed:false,expectedUpdatedAt:document.updatedAt})).document;
  assert.deepEqual(targetRows().map(e=>e.values.NR_ORDEM_COLHEITA),Array(10).fill('161'));
  await bulk('170',12);assert.equal(row(13).values.NR_ORDEM_COLHEITA,'14','Blank farms do not group');
  const before=structuredClone(document);
  await assert.rejects(()=>bulk('-1'),e=>e.code==='22023');
  assert.deepEqual((await docs('get',{id:document.id})).document,before);
  await assert.rejects(()=>docs('save-bulk',{id:document.id,entryIds:[document.entries[0].id],fieldKey:'NR_ORDEM_COLHEITA',value:'162',expectedUpdatedAt:initial.updatedAt}),e=>e.code==='PT409'||e.code==='40001');
  assert.deepEqual((await docs('get',{id:other.id})).document,other);
  for(let i=0;i<document.entries.length;i++){
   assert.deepEqual(document.entries[i].source,initial.entries[i].source);
   assert.deepEqual({...document.entries[i].values,NR_ORDEM_COLHEITA:initial.entries[i].values.NR_ORDEM_COLHEITA},initial.entries[i].values);
  }
  await setActor(ids.otherOwner);await assert.rejects(()=>bulk('162'));
  await setActor(ids.reader);await assert.rejects(()=>bulk('162'),e=>e.code==='42501');
  await setActor(null);await assert.rejects(()=>bulk('162'),e=>e.code==='28000');
 }finally{await db.close();}
});
