import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('client ledger filters and groups in SQL, preserves per-document types and isolates owner/client/status',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload),profiles=(action,payload)=>rpc('import-profiles',action,payload);
 const field=(key,column,type='text',required=false)=>({key,column,type,label:key,required,source:'manual',sourceKey:'',defaultValue:'',mappings:{}});
 const fields=[field('COD_FAZENDA','F','decimal'),field('COD_TALHAO','H'),field('COD_EQUIPAMENTO_TRANSPORTE','S','decimal'),field('PESOBRUTO','AA','decimal'),field('DATA','Q','date'),field('NOTES','A','text',true)];
 const template=Buffer.from('PRIVATE_TEMPLATE_MUST_NOT_ENTER_LEDGER'.repeat(200)).toString('base64');
 const input={name:'Ledger number',clientId:null,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields,templateBase64:template,templateName:'private-model.xlsx'};
 const entry=(date,originalGroup,seq,farm,plot,equipment,weight,notes)=>({date,source:{dataMovimento:date,entrada:originalGroup,sequencia:seq,fazendaOrigem:'999999',talhao:'777'},sourcePage:1,sourceLine:'Original source row',values:{COD_FAZENDA:farm,COD_TALHAO:plot,COD_EQUIPAMENTO_TRANSPORTE:equipment,PESOBRUTO:weight,DATA:date,NOTES:notes}});
 const imported=(profile,client,name,entries)=>docs('import',{profileId:profile.id,clientId:client,sourceName:name,sourceHash:createHash('sha256').update(client+name).digest('hex'),entries});
 const ledger=(filters={})=>docs('ledger',{clientId:ids.partner,status:'all',...filters});
 const rows=result=>result.groups.flatMap(group=>group.entries);
 const summary=(days,documents,entries,pending,groups,from,to)=>({dayCount:days,documentCount:documents,entryCount:entries,pendingCount:pending,reviewedCount:entries-pending,groupCount:groups,dateFrom:from,dateTo:to});
 const review=async(document,index)=>{const e=document.entries[index];return (await docs('save-entry',{id:document.id,entryId:e.id,date:e.date,values:e.values,reviewed:true,expectedUpdatedAt:document.updatedAt})).document;};
 try{
  const otherClient=(await rpc('clients','save',{legalName:'Ledger second company',tradeName:'SEGUNDA EMPRESA',cnpj:'11222333000181',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''})).client;
  const numeric=(await profiles('save',input)).profile;
  const text=(await profiles('save',{...input,name:'Ledger text',fields:fields.map(f=>f.key==='COD_EQUIPAMENTO_TRANSPORTE'?{...f,type:'text'}:f)})).profile;
  let first=(await imported(numeric,ids.partner,'first.pdf',[
   entry('2026-10-22','100','1','5010','21','123.125000','31.650000','A'),
   entry('2026-10-22','100','2','5011','015','123.125','20',''),
   entry('2026-10-23','101','1','5010','21','5','7.5','C'),
  ])).document;
  let second=(await imported(text,ids.partner,'second.pdf',[
   entry('2026-10-22','200','1','5010','015','0006105','9123456.789012','D'),
   entry('2026-10-22','200','2','','','0006105','1','E'),
  ])).document;
  await imported(numeric,otherClient.id,'other-client.pdf',[entry('2026-10-24','300','1','999','88','77','100','Hidden')]);
  first=await review(first,0);second=await review(second,1);
  const before=JSON.stringify([first,second]);
  const all=await ledger();
  assert.equal(all.clientId,ids.partner);assert.equal(all.clientName,'TAQUARI');assert.equal(all.canManage,true);
  assert.deepEqual(all.summary,summary(2,2,5,3,3,'2026-10-22','2026-10-23'));
  assert.equal(all.groups.length,1);assert.equal(all.groups[0].key,'none');assert.equal(all.groups[0].label,'Lançamentos');assert.deepEqual(all.groups[0].summary,all.summary);
  assert.equal(rows(all).length,5);assert.deepEqual(rows(all).map(row=>row.documentId),[first.id,first.id,first.id,second.id,second.id]);
  assert.deepEqual(rows(all).map(row=>row.entry.groupOrdinal),[1,1,2,1,1]);
  assert.deepEqual(rows(all).map(row=>row.bandOrdinal),[1,1,2,3,3]);assert.deepEqual(rows(all).map(row=>row.groupBand),['odd','odd','even','odd','odd']);assert.deepEqual(rows(all).map(row=>row.groupStart),[true,false,true,true,false]);
  assert.equal(all.documents.length,2);assert.deepEqual(all.documents.find(d=>d.id===first.id).fields,first.profileSnapshot.fields);assert.equal(all.documents.find(d=>d.id===second.id).fields.find(f=>f.key==='COD_EQUIPAMENTO_TRANSPORTE').type,'text');
  assert.equal(rows(all)[0].entry.values.COD_EQUIPAMENTO_TRANSPORTE,'123.125');assert.equal(rows(all)[3].entry.values.COD_EQUIPAMENTO_TRANSPORTE,'0006105');assert.equal(rows(all)[3].entry.values.PESOBRUTO,'9123456.789012');assert.equal(typeof rows(all)[3].entry.values.PESOBRUTO,'string');assert.equal(rows(all)[0].entry.values.DATA,'2026-10-22');
  assert.equal(JSON.stringify(all).includes(template),false);for(const d of all.documents){assert.equal('profileSnapshot'in d,false);assert.equal('templateBase64'in d,false);assert.equal('templateName'in d,false);}
  assert.deepEqual(all.facets.farms.map(f=>f.value),['__empty__','5010','5011']);assert.deepEqual(all.facets.plots.map(f=>f.value),['__empty__','015','21']);
  const days=await ledger({groupBy:'day'});assert.deepEqual(days.groups.map(group=>group.key),['2026-10-22','2026-10-23']);assert.deepEqual(days.groups[0].summary,summary(1,2,4,2,2,'2026-10-22','2026-10-22'));assert.deepEqual(days.groups[1].summary,summary(1,1,1,1,1,'2026-10-23','2026-10-23'));
  const farms=await ledger({groupBy:'farm'});assert.equal(farms.groups.find(group=>group.key==='5010').summary.entryCount,3);assert.equal(farms.groups.find(group=>group.key==='5011').summary.entryCount,1);
  const plots=await ledger({groupBy:'plot'});assert.equal(plots.groups.find(group=>group.key==='015').summary.entryCount,2);assert.equal(plots.groups.find(group=>group.key==='21').summary.groupCount,2);
  const source=await ledger({groupBy:'source-group'});assert.equal(source.groups.length,3);assert.deepEqual(source.groups.map(group=>group.entries.length),[2,1,2]);
  const filtered=await ledger({dateFrom:'2026-10-22',dateTo:'2026-10-22',farm:'5010',plot:'015'});assert.deepEqual(filtered.summary,summary(1,1,1,1,1,'2026-10-22','2026-10-22'));assert.equal(rows(filtered)[0].documentId,second.id);assert.equal(rows(filtered)[0].entry.values.COD_EQUIPAMENTO_TRANSPORTE,'0006105');assert.deepEqual(filtered.facets.farms,all.facets.farms);
  const missing=await ledger({farm:'__empty__'});assert.equal(rows(missing).length,1);assert.equal(rows(missing)[0].entry.values.COD_FAZENDA,'');
  const empty=await ledger({farm:'999999'});assert.deepEqual(empty.summary,summary(0,0,0,0,0,null,null));assert.deepEqual(empty.groups,[]);assert.deepEqual(empty.documents,[]);
  assert.equal((await ledger({dateFrom:'2026-10-23',dateTo:'2026-10-23'})).summary.entryCount,1);assert.equal((await ledger({dateFrom:'2026-10-24'})).summary.entryCount,0);
  assert.equal(JSON.stringify([(await docs('get',{id:first.id})).document,(await docs('get',{id:second.id})).document]),before,'Ledger reads never mutate source values, types, review flags or snapshots');
  second=await review(second,0);second=(await docs('finalize',{id:second.id,expectedUpdatedAt:second.updatedAt})).document;
  assert.deepEqual((await ledger({status:'open'})).summary,summary(2,1,3,2,2,'2026-10-22','2026-10-23'));
  assert.deepEqual((await ledger({status:'finished'})).summary,summary(1,1,2,0,1,'2026-10-22','2026-10-22'));
  const other=await docs('ledger',{clientId:otherClient.id});assert.equal(other.summary.entryCount,1);assert.equal(rows(other)[0].entry.values.COD_FAZENDA,'999');
  for(const payload of [{groupBy:'client'},{status:'pending'},{dateFrom:'2026-02-30'},{dateFrom:'2026-10-23',dateTo:'2026-10-22'},{dateFrom:'0000-01-01'},{dateFrom:20261022},{farm:{}},{ownerId:ids.otherOwner},{farm:'x'.repeat(161)}])await assert.rejects(()=>ledger(payload),error=>error.code==='22023');
  await assert.rejects(()=>docs('ledger',{clientId:'invalid'}),error=>error.code==='22023');await assert.rejects(()=>docs('ledger',{clientId:ids.otherPartner}),error=>error.code==='P0002');
  await assert.rejects(()=>db.query('select billing_private.import_client_ledger($1,$2,$3,$4,$5,$6,$7,$8)',[ids.owner,ids.partner,'all',null,null,'','','none']),error=>error.code==='42501');
  await setActor(ids.reader);await assert.rejects(()=>ledger(),error=>error.code==='42501');
  await db.exec('RESET ROLE');await db.query("UPDATE public.billing_access_profiles SET permissions=array_append(permissions,'registrations.read') WHERE owner_id=$1 AND id=$2",[ids.owner,ids.readerProfile]);await setActor(ids.reader);
  const reader=await ledger();assert.equal(reader.canManage,false);assert.equal(reader.summary.entryCount,5);
  await setActor(ids.otherOwner);await assert.rejects(()=>ledger(),error=>error.code==='P0002');assert.equal((await docs('ledger',{clientId:ids.otherPartner})).summary.entryCount,0);
  await setActor(null);await assert.rejects(()=>ledger(),error=>error.code==='28000');
 }finally{await db.close();}
});
