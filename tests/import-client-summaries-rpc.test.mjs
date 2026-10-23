import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('Client/day summaries count distinct PDFs and entries, preserve typed details and isolate accounts',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const profiles=(action,payload)=>rpc('import-profiles',action,payload);
 const field=(key,column,type,required=false)=>({key,column,label:key,type,required,source:'manual',sourceKey:'',defaultValue:'',mappings:{}});
 const fields=[field('PESOBRUTO','A','decimal'),field('TARA','B','decimal'),field('CODE','C','text',true),field('DATA','D','date')];
 const template=Buffer.from('DISTINCT_TEMPLATE_NOT_FOR_LISTING_'.repeat(1000)).toString('base64');
 const profileInput={name:'Modelo numérico',clientId:null,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields,templateBase64:template,templateName:'modelo.xlsx'};
 const entry=(date,code,gross,tare)=>({date,values:{PESOBRUTO:gross,TARA:tare,CODE:code,DATA:date},source:{pesoBruto:gross},sourcePage:1,sourceLine:'RAW_DETAIL_ONLY_NEVER_LIST'});
 const imported=(profileId,clientId,name,entries)=>docs('import',{profileId,clientId,sourceName:name,sourceHash:createHash('sha256').update(clientId+name).digest('hex'),entries});
 const review=async(document,index)=>{
  const e=document.entries[index];return (await docs('save-entry',{id:document.id,entryId:e.id,date:e.date,values:e.values,reviewed:true,expectedUpdatedAt:document.updatedAt})).document;
 };
 const summary=(days,documents,entries,pending,from,to)=>({dayCount:days,documentCount:documents,entryCount:entries,pendingCount:pending,reviewedCount:entries-pending,dateFrom:from,dateTo:to});
 try{
  const clientB=(await rpc('clients','save',{legalName:'Segunda empresa LTDA',tradeName:'CLIENTE B',cnpj:'11222333000181',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''})).client;
  const numeric=(await profiles('save',profileInput)).profile;
  const text=(await profiles('save',{...profileInput,name:'Modelo texto',fields:fields.map(f=>f.key==='PESOBRUTO'?{...f,type:'text'}:f)})).profile;
  let first=(await imported(numeric.id,ids.partner,'first.pdf',[
   entry('2026-10-22','A','12,125600','2'),entry('2026-10-22','','3','1,25'),entry('2026-10-23','C','5','2.5'),
  ])).document;
  first=await review(first,0);first=await review(first,2);
  let second=(await imported(text.id,ids.partner,'second.pdf',[
   entry('2026-10-22','D','0006,500','1.125000'),entry('2026-10-22','E','004,001','1'),
  ])).document;
  second=await review(second,1);
  await imported(numeric.id,clientB.id,'other-client.pdf',[entry('2026-10-24','B1','100','2'),entry('2026-10-24','B2','200','3')]);

  const collection=await docs('list',{status:'all'});assert.equal(collection.total,3);
  const a=collection.clients.find(c=>c.clientId===ids.partner);const b=collection.clients.find(c=>c.clientId===clientB.id);
  assert.deepEqual(a.summary,summary(2,2,5,2,'2026-10-22','2026-10-23'));
  assert.deepEqual(b.summary,summary(1,1,2,2,'2026-10-24','2026-10-24'));
  assert.deepEqual(a.days.map(d=>d.date),['2026-10-23','2026-10-22']);
  const day22=a.days.find(d=>d.date==='2026-10-22');const day23=a.days.find(d=>d.date==='2026-10-23');
  assert.deepEqual(day22.summary,summary(1,2,4,2,'2026-10-22','2026-10-22'));
  assert.deepEqual(day23.summary,summary(1,1,1,0,'2026-10-23','2026-10-23'));
  assert.equal(day22.documents.find(d=>d.id===first.id).dayEntryCount,2);
  assert.equal(day23.documents.find(d=>d.id===first.id).dayEntryCount,1);
  assert.equal(day22.documents.find(d=>d.id===first.id).entryCount,3,'A multi-day PDF is counted once per client');
  for(const client of collection.clients)for(const day of client.days)for(const document of day.documents){
   assert.equal('entries' in document,false);assert.equal('profileSnapshot' in document,false);
  }
  assert.equal(JSON.stringify(collection).includes(template),false);assert.equal(JSON.stringify(collection).includes('RAW_DETAIL_ONLY_NEVER_LIST'),false);
  assert.equal((await docs('list',{status:'all',clientId:ids.partner})).total,2);
  assert.equal((await docs('list',{status:'all',clientId:ids.partner})).clients.length,1);
  assert.equal((await docs('list',{status:'all',search:'CLIENTE B'})).clients[0].clientId,clientB.id);

  const firstDetail=await docs('get',{id:first.id});
  assert.deepEqual(firstDetail.document,first,'Summary reads never rewrite the document or its snapshot');
  assert.deepEqual(firstDetail.summary,summary(2,1,3,1,'2026-10-22','2026-10-23'));
  assert.deepEqual(firstDetail.daySummaries.find(d=>d.date==='2026-10-22').summary,summary(1,1,2,1,'2026-10-22','2026-10-22'));
  assert.equal(firstDetail.document.entries[0].values.PESOBRUTO,'12.1256');assert.equal(typeof firstDetail.document.entries[0].values.PESOBRUTO,'string');
  assert.equal(firstDetail.document.profileSnapshot.templateBase64,template);
  const textDetail=(await docs('get',{id:second.id})).document;
  assert.equal(textDetail.entries[0].values.PESOBRUTO,'0006,500');assert.equal(textDetail.profileSnapshot.fields[0].type,'text');
  assert.equal(firstDetail.document.profileSnapshot.fields[0].type,'decimal','Different models on the same day retain their own column types');

  second=await review(second,0);await docs('finalize',{id:second.id,expectedUpdatedAt:second.updatedAt});
  assert.deepEqual((await docs('list',{clientId:ids.partner,status:'open'})).clients[0].summary,summary(2,1,3,1,'2026-10-22','2026-10-23'));
  assert.deepEqual((await docs('list',{clientId:ids.partner,status:'finished'})).clients[0].summary,summary(1,1,2,0,'2026-10-22','2026-10-22'));
  assert.equal((await docs('list',{status:'all',search:'second.pdf'})).total,1);
  await assert.rejects(()=>docs('list',{clientId:'not-a-uuid'}),e=>e.code==='22023');
  await assert.rejects(()=>docs('list',{ownerId:ids.otherOwner}),e=>e.code==='22023');
  await assert.rejects(()=>db.query('select billing_private.import_client_collection($1,$2,$3,$4)',[ids.owner,'all','',null]),e=>e.code==='42501');

  await setActor(ids.otherOwner);
  assert.equal((await docs('list',{status:'all',clientId:ids.partner})).total,0);
  assert.deepEqual((await docs('list',{status:'all',clientId:ids.partner})).clients,[]);
  await assert.rejects(()=>docs('get',{id:first.id}),e=>e.code==='P0002');
  const foreignProfile=(await profiles('save',{...profileInput,name:'Outro proprietário'})).profile;
  await imported(foreignProfile.id,ids.otherPartner,'foreign.pdf',[entry('2026-10-25','F','1','0')]);
  assert.equal((await docs('list',{status:'all'})).total,1);
  await setActor(ids.owner);assert.equal((await docs('list',{status:'all'})).total,3);
  await db.exec('RESET ROLE');await db.query("UPDATE public.billing_access_profiles SET permissions=array_append(permissions,'registrations.read') WHERE owner_id=$1 AND id=$2",[ids.owner,ids.readerProfile]);
  await setActor(ids.reader);
  const readonly=await docs('list',{status:'all',clientId:ids.partner});assert.equal(readonly.canManage,false);assert.equal(readonly.total,2);
  assert.equal((await docs('get',{id:first.id})).summary.entryCount,3);
  await setActor(null);await assert.rejects(()=>docs('list',{status:'all'}),e=>e.code==='28000');
 }finally{await db.close();}
});
