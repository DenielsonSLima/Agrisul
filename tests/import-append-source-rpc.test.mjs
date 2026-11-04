import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('missing Pinheiro pages append atomically, preserve edited cells and reuse the existing vehicle group',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const field=(key,column,type='text',sourceKey='',defaultValue='',source=sourceKey?'pdf':'manual')=>({key,column,type,sourceKey,defaultValue,source,label:key,required:false,mappings:{},pattern:''});
 const fields=[field('COD_TIPOCOLHEITA','K','text','','2','fixed'),field('COD_ENTRADA','L','decimal','entradaSequencialConjunto'),
  field('COD_TIPOCARGA','R','text','quantidadeAnalisesConjunto'),field('PESOBRUTO','AA','decimal','pesoBrutoConvencional'),field('TARA','AB','decimal','taraConvencional'),
  field('NUMERO_ANALISE','Z'),field('COD_TALHAO','H','decimal'),field('COD_EQUIPAMENTO_TRANSPORTE','S','decimal'),field('COD_EQUIPAMENTO_COMPARTIMENTO','Y','decimal')];
 const row=(number,ba='2026-10-31T19:21',tare='2026-10-31T20:19',weight='33.890')=>({date:'2026-10-31',source:{
  periodoInicio:'2026-10-31T06:00',periodoFim:'2026-11-01T05:59',dataHoraBA:ba,dataHoraTara:tare,numeroAnalise:number,
  pesoAnalisado:weight,origemTipo:'fotografia',fazendaOrigem:'311272',fazendaNome:'TAPERA'},
  values:Object.fromEntries(fields.map(f=>[f.key,f.defaultValue])),sourcePage:2,sourceLine:`311272-TAPERA ${number} ${weight}`});
 const newGroup=()=>[row('946872','2026-10-31T22:45','2026-10-31T23:13','27.420'),row('946873','2026-10-31T22:45','2026-10-31T23:13','9.140'),row('946874','2026-10-31T22:45','2026-10-31T23:13','9.150')];
 const fail=async(fn,codes)=>assert.rejects(fn,e=>codes.includes(e.code));
 try {
  const profile=(await rpc('import-profiles','save',{name:'Pinheiro append fixture',clientId:ids.partner,parser:'pinheiro-usjp-v1',sheetName:'Plan1',startRow:2,entrySequenceStart:'806',fields})).profile;
  const imported=async(label,entries)=>(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:label,sourceHash:createHash('sha256').update(label).digest('hex'),entries})).document;
  let document=await imported('page1',[row('946837')]);
  const other=await imported('unrelated',[row('900001','2026-10-31T10:00','2026-10-31T11:00','20')]);
  document=(await docs('save-entry',{id:document.id,entryId:document.entries[0].id,date:'2026-10-31',values:{...document.entries[0].values,PESOBRUTO:'40.890',COD_TALHAO:'25',COD_EQUIPAMENTO_TRANSPORTE:'99',COD_EQUIPAMENTO_COMPARTIMENTO:'99'},reviewed:true,expectedUpdatedAt:document.updatedAt})).document;
  const before=structuredClone(document);
  const input={id:document.id,expectedUpdatedAt:document.updatedAt,entries:[row('946838'),...newGroup()]};
  const result=await docs('append-source-entries',input);document=result.document;
  assert.equal(result.appendedCount,4);assert.equal(document.entryCount,5);assert.equal(document.status,'open');
  assert.deepEqual(document.profileSnapshot,before.profileSnapshot,'Snapshot must remain unchanged');
  const old=document.entries.find(e=>e.id===before.entries[0].id);
  assert.deepEqual(old.values,{...before.entries[0].values,COD_TIPOCARGA:'2'},'Edited gross, equipment, plot and saved code are preserved');
  assert.equal(old.sourceLine,before.entries[0].sourceLine);assert.equal(old.reviewed,false);assert.equal(old.source.quantidadeAnalisesConjunto,'2');
  const continued=document.entries.find(e=>e.source.numeroAnalise==='946838');
  assert.equal(continued.groupKey,old.groupKey);assert.equal(continued.values.COD_ENTRADA,old.values.COD_ENTRADA);
  assert.equal(continued.values.TARA,'2');assert.equal(continued.values.PESOBRUTO,'35.89');assert.equal(continued.values.COD_TIPOCARGA,'2');
  assert.equal(continued.values.COD_EQUIPAMENTO_TRANSPORTE,'');assert.equal(continued.sourcePage,2);
  const addedGroup=document.entries.filter(e=>e.source.numeroAnalise>='946872');
  assert.deepEqual(addedGroup.map(e=>e.values.TARA),['1','2','3']);
  assert.deepEqual(addedGroup.map(e=>e.values.PESOBRUTO),['28.42','11.14','12.15']);
  assert.equal(new Set(addedGroup.map(e=>e.values.COD_ENTRADA)).size,1);
  assert.equal(addedGroup[0].values.COD_ENTRADA,String(Number(other.entries[0].values.COD_ENTRADA)+1),'New groups continue the global sequence');
  assert.equal(document.entries.every(e=>e.values.NUMERO_ANALISE===''),true);
  assert.deepEqual((await docs('get',{id:other.id})).document,other,'Other documents remain unchanged');
  await fail(()=>docs('append-source-entries',input),['40001','PT409']);
  const append=entries=>docs('append-source-entries',{id:document.id,expectedUpdatedAt:document.updatedAt,entries});
  await fail(()=>append([row('946838')]),['22023']);
  await fail(()=>append([row('900001','2026-10-31T10:00','2026-10-31T11:00','20')]),['23514']);
  await fail(()=>append([row('990001'),{...row('990002'),source:{...row('990002').source,origemTipo:42}}]),['22023']);
  await fail(()=>append([{...row('990001'),id:ids.otherOwner}]),['22023']);
  await fail(()=>append([{...row('990001'),values:{...row('990001').values,COD_TALHAO:'not a number'}}]),['22023']);
  await fail(()=>append([{...row('990001'),source:{...row('990001').source,periodoInicio:'2026-11-01T06:00',periodoFim:'2026-11-02T05:59',dataHoraBA:'2026-11-01T19:21',dataHoraTara:'2026-11-01T20:19'}}]),['22023']);
  await fail(()=>docs('append-source-entries',{id:document.id,expectedUpdatedAt:document.updatedAt,entries:[row('990001')],ownerId:ids.otherOwner}),['22023']);
  assert.deepEqual((await docs('get',{id:document.id})).document,document,'Failed batches roll back old group corrections and new rows');
  await setActor(ids.otherOwner);await fail(()=>append([row('990001')]),['P0002']);
  await setActor(ids.reader);await fail(()=>append([row('990001')]),['42501']);
  await setActor(null);await fail(()=>append([row('990001')]),['28000']);
  await setActor();
  const taquari=(await rpc('import-profiles','save',{name:'Other layout append denial',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[field('NOTE','A')]})).profile;
  const otherLayout=(await docs('import',{profileId:taquari.id,clientId:ids.partner,sourceName:'Other layout',sourceHash:createHash('sha256').update('other layout').digest('hex'),entries:[{date:'2026-10-31',source:{},values:{NOTE:''},sourcePage:1,sourceLine:'Original'}]})).document;
  await fail(()=>docs('append-source-entries',{id:otherLayout.id,expectedUpdatedAt:otherLayout.updatedAt,entries:[row('990001')]}),['22023']);
  let custom=await imported('custom quantity',[row('995001','2026-10-31T12:00','2026-10-31T13:00','10')]);
  custom=(await docs('save-entry',{id:custom.id,entryId:custom.entries[0].id,date:'2026-10-31',values:{...custom.entries[0].values,COD_TIPOCARGA:'8'},reviewed:false,expectedUpdatedAt:custom.updatedAt})).document;
  await fail(()=>docs('append-source-entries',{id:custom.id,expectedUpdatedAt:custom.updatedAt,entries:[row('995002','2026-10-31T12:00','2026-10-31T13:00','11')]}),['23514']);
  assert.deepEqual((await docs('get',{id:custom.id})).document,custom,'Custom group quantity is never overwritten');
  let manual=await imported('manual row',[row('996001','2026-10-31T14:00','2026-10-31T15:00','10')]);
  manual=(await docs('save-entry',{id:manual.id,date:'2026-10-31',values:{},reviewed:false,expectedUpdatedAt:manual.updatedAt})).document;
  await fail(()=>docs('append-source-entries',{id:manual.id,expectedUpdatedAt:manual.updatedAt,entries:[row('996002','2026-10-31T14:00','2026-10-31T15:00','11')]}),['23514']);
  const linked=await imported('linked fixture',[row('997001','2026-10-31T16:00','2026-10-31T17:00','10')]);
  await db.exec('RESET ROLE');
  const farm=(await db.query("INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,'Linked append fixture',100,'Capela','SE') RETURNING id",[ids.owner])).rows[0].id;
  const type=(await db.query("INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Append fixture','[]') RETURNING id",[ids.owner])).rows[0].id;
  const contract=(await db.query("INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Append fixture',$2,$3,$4,'Cana','[]','Ativo','2026-10-01',1000) RETURNING id",[ids.owner,ids.company,ids.partner,type])).rows[0].id;
  const load=(await db.query("INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,loaded_at,volume) VALUES($1,$2,$3,'2026-10-31',10) RETURNING id",[ids.owner,contract,farm])).rows[0].id;
  await db.query("INSERT INTO public.billing_import_load_links(owner_id,document_id,trip_key,load_id) VALUES($1,$2,$3,$4)",[ids.owner,linked.id,linked.entries[0].groupKey,load]);
  await setActor();
  await fail(()=>docs('append-source-entries',{id:linked.id,expectedUpdatedAt:linked.updatedAt,entries:[row('997002','2026-10-31T16:00','2026-10-31T17:00','11')]}),['23514']);
  assert.deepEqual((await docs('get',{id:linked.id})).document,linked,'Linked documents remain unchanged');
  document=(await docs('finalize',{id:document.id,expectedUpdatedAt:document.updatedAt})).document;
  await fail(()=>append([row('990001')]),['23514']);
  await fail(()=>db.query("insert into public.billing_import_entries(owner_id,document_id,entry_date,position) values($1,$2,'2026-10-31',99)",[ids.owner,document.id]),['42501']);
  await fail(()=>db.query("select billing_private.import_documents_dispatch('append-source-entries',$1::jsonb)",[JSON.stringify({id:document.id,expectedUpdatedAt:document.updatedAt,entries:[row('990001')]})]),['42501']);
  await fail(()=>db.query("select billing_private.append_import_source_entries($1::jsonb)",[JSON.stringify({id:document.id,expectedUpdatedAt:document.updatedAt,entries:[row('990001')]})]),['42501']);
 }finally{await db.close();}
});
