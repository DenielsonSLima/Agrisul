import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('harvest orders match farm + plot across the whole document, atomically and within the authorized workspace',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const field=(key,column,type='text')=>({key,column,type,source:'manual',sourceKey:'',label:key,required:false,defaultValue:'',mappings:{},pattern:''});
 const fields=[field('COD_FAZENDA','F'),field('COD_TALHAO','H'),field('NR_ORDEM_COLHEITA','AC','decimal'),field('PESOBRUTO','AA','decimal')];
 const entries=[['5010','01','12'],['5010','1','13'],['5011','01','14'],['5010','02','15'],['','01','16']].map(([farm,plot,order],i)=>({date:i%2?'2026-10-30':'2026-10-29',source:{},sourcePage:1,sourceLine:'row '+i,values:{COD_FAZENDA:farm,COD_TALHAO:plot,NR_ORDEM_COLHEITA:order,PESOBRUTO:'25.1'}}));
 try{
  const {profile}=await rpc('import-profiles','save',{name:'Ordens por talhão',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields});
  const imported=async name=>(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:name,sourceHash:createHash('sha256').update(name).digest('hex'),entries})).document;
  let document=await imported('orders.pdf');const another=await imported('another.pdf');
  let options=await docs('harvest-order-options',{id:document.id});assert.equal(options.orders.length,3);assert.equal(options.missingCount,1);
  assert.deepEqual(options.orders.find(r=>r.farm==='5010'&&r.plot==='1'),{farm:'5010',farmName:'',plot:'1',entryCount:2,currentOrders:['12','13']});
  for(const row of document.entries){document=(await docs('save-entry',{id:document.id,entryId:row.id,date:row.date,values:row.values,reviewed:true,expectedUpdatedAt:document.updatedAt})).document;}
  const before=structuredClone(document);const input={id:document.id,expectedUpdatedAt:document.updatedAt,orders:[{farm:'05010',plot:'01',order:'149'},{farm:'5011',plot:'1',order:'135'}]};
  const result=await docs('save-harvest-orders',input);document=result.document;assert.equal(result.changedCount,3);
  for(const row of document.entries){const old=before.entries.find(e=>e.id===row.id);const expected=old.values.COD_TALHAO==='02'||!old.values.COD_FAZENDA?old.values.NR_ORDEM_COLHEITA:old.values.COD_FAZENDA==='5011'?'135':'149';assert.equal(row.values.NR_ORDEM_COLHEITA,expected);assert.deepEqual({...row.values,NR_ORDEM_COLHEITA:old.values.NR_ORDEM_COLHEITA},old.values);assert.deepEqual(row.source,old.source);assert.equal(row.reviewed,expected===old.values.NR_ORDEM_COLHEITA);}
  assert.deepEqual((await docs('get',{id:another.id})).document,another,'Other documents stay unchanged');
  await assert.rejects(()=>docs('save-harvest-orders',input),e=>e.code==='40001');
  const save=orders=>docs('save-harvest-orders',{id:document.id,expectedUpdatedAt:document.updatedAt,orders});
  for(const orders of [[],[{farm:'5010',plot:'1',order:'0'}],[{farm:'5010',plot:'1',order:'1.5'}],[{farm:'5010',plot:'1',order:'3',owner_id:ids.otherOwner}],[{farm:'5010',plot:'1',order:'3'},{farm:'05010',plot:'01',order:'4'}],[{farm:'5010',plot:'1',order:'3'},{farm:'999',plot:'1',order:'4'}]])await assert.rejects(()=>save(orders),e=>e.code==='22023');
  assert.deepEqual((await docs('get',{id:document.id})).document,document,'Invalid later items roll back the entire batch');
  const noop=await save([{farm:'5010',plot:'1',order:'149'}]);assert.equal(noop.changedCount,0);assert.equal(noop.document.updatedAt,document.updatedAt);
  const textProfile=(await rpc('import-profiles','save',{name:'Ordens como texto',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:fields.map(f=>f.key==='NR_ORDEM_COLHEITA'?{...f,type:'text'}:f)})).profile;
  const textDocument=(await docs('import',{profileId:textProfile.id,clientId:ids.partner,sourceName:'text-orders.pdf',sourceHash:createHash('sha256').update('text-orders').digest('hex'),entries})).document;
  const textResult=await docs('save-harvest-orders',{id:textDocument.id,expectedUpdatedAt:textDocument.updatedAt,orders:[{farm:'5010',plot:'01',order:'000149'}]});
  assert.equal(textResult.changedCount,2);assert.deepEqual(textResult.document.entries.filter(e=>e.values.COD_FAZENDA==='5010'&&['01','1'].includes(e.values.COD_TALHAO)).map(e=>e.values.NR_ORDEM_COLHEITA),['000149','000149']);
  await setActor(ids.otherOwner);await assert.rejects(()=>docs('harvest-order-options',{id:document.id}));await assert.rejects(()=>save([{farm:'5010',plot:'1',order:'2'}]));
  await setActor(ids.reader);await assert.rejects(()=>save([{farm:'5010',plot:'1',order:'2'}]),e=>e.code==='42501');
  await setActor(null);await assert.rejects(()=>docs('harvest-order-options',{id:document.id}));
  await setActor();await assert.rejects(()=>db.query("update public.billing_import_entry_values set decimal_value=7 where entry_id=$1",[document.entries[0].id]),e=>e.code==='42501');
  document=(await docs('finalize',{id:document.id,expectedUpdatedAt:document.updatedAt})).document;
  await assert.rejects(()=>save([{farm:'5010',plot:'1',order:'2'}]),e=>e.code==='23514');
 }finally{await db.close();}
});
