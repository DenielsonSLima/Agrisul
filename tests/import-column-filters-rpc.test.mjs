import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('column filters and typed sorting share the exact export projection and enforce revisions and owner isolation',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const field=(key,column,type='text',required=false)=>({key,column,type,label:key,required,source:'manual',defaultValue:'',sourceKey:'',mappings:{}});
 try{
  const profile=(await rpc('import-profiles','save',{name:'Column filters',clientId:null,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[field('FARM','A'),field('WEIGHT','B','decimal'),field('CODE','C'),field('DATE','D','date'),field('NOTES','E','text',true),field('COD_FAZENDA','F'),field('COD_TALHAO','H')]})).profile;
  const row=(date,farm,weight,code,notes='')=>({date,source:{dataMovimento:date,entrada:code},sourcePage:1,sourceLine:'fixture',values:{FARM:farm,WEIGHT:weight,CODE:code,DATE:date,NOTES:notes,COD_FAZENDA:farm,COD_TALHAO:'01'}});
  const document=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'filters.pdf',sourceHash:createHash('sha256').update('filters').digest('hex'),entries:[row('2026-10-22','A','10','0001'),row('2026-10-23','B','2','0002','ok'),row('2026-10-22','A','','0003'),row('2026-10-23','A','123456789012345.123456','0004')]})).document;
  const table=(filters={})=>docs('table',{id:document.id,...filters});
  const exportView=(filters={})=>docs('export-filtered',{id:document.id,expectedUpdatedAt:document.updatedAt,...filters});
  const codes=result=>result.entries.map(e=>e.values.CODE);
  const all=await table();assert.equal(all.summary.entryCount,4);assert.equal(all.summary.pendingCount,4);assert.deepEqual(all.facets.WEIGHT,['','10','123456789012345.123456','2']);
  assert.deepEqual(codes(await table({sortKey:'WEIGHT'})),['0002','0001','0004','0003']);
  assert.deepEqual(codes(await table({sortKey:'WEIGHT',sortDirection:'desc'})),['0004','0001','0002','0003']);
  assert.deepEqual(codes(await table({sortKey:'CODE',sortDirection:'desc'})),['0004','0003','0002','0001']);
  const filters={columnFilters:{FARM:['A'],DATE:['2026-10-22']},sortKey:'CODE',sortDirection:'desc'};
  const result=await table(filters);assert.deepEqual(codes(result),['0003','0001']);assert.equal(result.summary.entryCount,2);assert.equal(result.summary.dayCount,1);assert.equal(result.summary.pendingCount,2);
  assert.equal(result.entries[1].values.CODE,'0001');assert.deepEqual(result.facets.FARM,['A','B']);
  const exported=await exportView(filters);assert.deepEqual(exported.rows.map(r=>r.entryId),result.entries.map(e=>e.id));assert.equal(exported.rows.length,2);assert.equal(exported.rows[0].values.C,'0003');assert.equal(exported.rows[0].values.B,'');
  const day=await table({date:'2026-10-23',farm:'A',plot:'01'});assert.deepEqual(codes(day),['0004']);
  assert.deepEqual((await exportView({date:'2026-10-23',farm:'A',plot:'01'})).rows.map(r=>r.entryId),day.entries.map(e=>e.id));
  assert.deepEqual(codes(await table({columnFilters:{WEIGHT:['']}})),['0003']);
  assert.equal((await table({columnFilters:{FARM:[]}})).summary.entryCount,0);
  await assert.rejects(()=>exportView({columnFilters:{FARM:[]}}),/Nenhum lançamento/);
  await assert.rejects(()=>table({columnFilters:{UNKNOWN:['x']}}),/desconhecida/);
  await assert.rejects(()=>table({columnFilters:{FARM:'A'}}),/valores válidos/);
  await assert.rejects(()=>table({sortKey:'WEIGHT;drop table users'}),/desconhecida/);
  await assert.rejects(()=>table({dateFrom:'2026-10-25',dateTo:'2026-10-21'}),/posterior/);
  await assert.rejects(()=>table({date:'2026-02-31'}),/filtros/);
  await assert.rejects(()=>docs('export-filtered',{id:document.id}),/atualizado/);
  const ledger=await docs('ledger',{clientId:ids.partner,status:'open'});assert.equal(ledger.documents[0].summary.entryCount,4);assert.equal(ledger.documents[0].summary.pendingCount,4);
  await setActor(ids.otherOwner);await assert.rejects(()=>table(),/encontrada/);await assert.rejects(()=>exportView(),/encontrada/);
  await setActor(ids.reader);await assert.rejects(()=>table(),/permissão/i);
  await setActor(null);await assert.rejects(()=>table(),/Entre|Sessão|login/i);
  await setActor();const e=document.entries[0];await docs('save-entry',{id:document.id,entryId:e.id,date:e.date,values:{...e.values,NOTES:'updated'},reviewed:false,expectedUpdatedAt:document.updatedAt});
  await assert.rejects(()=>exportView(),/atualizado/);
 }finally{await db.close();}
});
