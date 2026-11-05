import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('linked imports reopen and save exact load corrections atomically, preserving IDs, manual ATR and text destination',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const deny=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 try{
  await db.exec('RESET ROLE');
  const farm=(await db.query("INSERT INTO public.billing_farms(owner_id,code,name,area_ha,city,state) VALUES($1,'5030','Origem',100,'Capela','SE') RETURNING id",[ids.owner])).rows[0].id;
  const plot=(await db.query("INSERT INTO public.billing_farm_plots(owner_id,farm_id,name,area_ha) VALUES($1,$2,'01',10) RETURNING id",[ids.owner,farm])).rows[0].id;
  const plot2=(await db.query("INSERT INTO public.billing_farm_plots(owner_id,farm_id,name,area_ha) VALUES($1,$2,'02',10) RETURNING id",[ids.owner,farm])).rows[0].id;
  const type=(await db.query("INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'MANUAL','[]') RETURNING id",[ids.owner])).rows[0].id;
  const contract=(await db.query("INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Correções',$2,$3,$4,'MANUAL','[]','Ativo','2026-10-01',1000) RETURNING id",[ids.owner,ids.company,ids.partner,type])).rows[0].id;
  await setActor();
  const field=(key,column,type='text')=>({key,column,type,label:key,source:'manual',sourceKey:'',required:false,defaultValue:'',mappings:{},pattern:''});
  const profile=(await rpc('import-profiles','save',{name:'Correções vinculadas',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,
   fields:[field('COD_ENTRADA','L'),field('COD_TIPOCOLHEITA','K'),field('COD_FAZENDA','F'),field('COD_TALHAO','H'),field('AREA','I','decimal'),field('PESOBRUTO','AA','decimal'),field('TARA','AB','decimal')]})).profile;
  const destination=profile.fields.find(f=>f.key==='COD_DESTINO');assert.equal(destination.type,'text');assert.equal(destination.column,'AC');
  const row=(trip,seq,gross)=>({date:'2026-10-29',source:{entrada:trip,sequencia:String(seq),dataMovimento:'2026-10-29'},
   values:{COD_ENTRADA:trip,COD_TIPOCOLHEITA:'1',COD_FAZENDA:'5030',COD_TALHAO:'1',PESOBRUTO:gross,TARA:'1'},sourcePage:1,sourceLine:'Teste'});
  let doc=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'edicoes.pdf',sourceHash:'a'.repeat(64),entries:[row('101',1,'21'),row('101',2,'11'),row('102',1,'6')]})).document;
  const revise=()=>({id:doc.id,expectedUpdatedAt:doc.updatedAt});
  doc=(await docs('finalize',revise())).document;
  const scope={companyId:ids.company,contractId:contract};
  const queue=(await docs('pending-loads',scope)).loads;
  const linked=await docs('link-load',{...scope,...revise(),tripKey:queue.find(q=>q.entryNumber==='101').tripKey,farmId:farm,plotId:plot,
   atrMode:'parts',atr:'',atrParts:doc.entries.slice(0,2).map((e,i)=>({entryId:e.id,atr:i?'160':'100'}))});
  const general=await docs('link-load',{...scope,...revise(),tripKey:queue.find(q=>q.entryNumber==='102').tripKey,farmId:farm,plotId:plot,atrMode:'general',atr:'143.47',atrParts:[]});
  doc=(await docs('reopen',revise())).document;assert.equal(doc.status,'open');
  const save=async(entry,values,date=entry.date)=>{doc=(await docs('save-entry',{...revise(),entryId:entry.id,date,values:{...entry.values,...values},reviewed:false})).document;};
  await save(doc.entries[0],{PESOBRUTO:'31',COD_DESTINO:'000042'});
  let detail=(await rpc('contracts','get',{companyId:ids.company,id:contract})).contract;
  let load=detail.loads.find(l=>l.id===linked.load.id);assert.equal(load.volume,'40');assert.equal(load.atr,'115');assert.equal(load.imported,true);
  assert.equal(detail.loads.find(l=>l.id===general.load.id).atr,'143.47');assert.equal(detail.loadedVolume,'45');
  doc=(await docs('save-plot-area',{...revise(),entryIds:doc.entries.slice(0,2).map(e=>e.id),value:'2'})).document;
  assert.equal(doc.entries[0].values.AREA,'10');
  detail=(await rpc('contracts','get',{companyId:ids.company,id:contract})).contract;
  assert.equal(detail.loads.find(l=>l.id===linked.load.id).plotId,plot2);
  await save(doc.entries[2],{PESOBRUTO:'9'},'2026-10-30');
  detail=(await rpc('contracts','get',{companyId:ids.company,id:contract})).contract;
  assert.equal(detail.loads.find(l=>l.id===general.load.id).atr,'143.47');assert.equal(detail.loads.find(l=>l.id===general.load.id).loadedAt,'2026-10-30');
  assert.equal(detail.loads.length,2);
  const before=doc;
  await deny(()=>docs('save-entry',{...revise(),entryId:doc.entries[0].id,date:doc.entries[0].date,values:{...doc.entries[0].values,PESOBRUTO:'0'},reviewed:false}),'23514');
  doc=(await docs('get',{id:doc.id})).document;assert.deepEqual(doc,before,'Invalid source edits roll back source cells, load and revision');
  await deny(()=>docs('change-column-type',{...revise(),fieldKey:'COD_DESTINO',type:'decimal'}),'22023');
  await deny(()=>docs('save-entry',{...revise(),expectedUpdatedAt:'2000-01-01',entryId:doc.entries[0].id,date:doc.entries[0].date,values:doc.entries[0].values,reviewed:false}),'PT409');
  const exported=await docs('export-filtered',revise());
  assert.equal(exported.columns.find(f=>f.key==='COD_DESTINO').type,'text');assert.equal(exported.rows[0].values.AC,'000042');
  await setActor(ids.otherOwner);await deny(()=>docs('reopen',revise()),'P0002');
  await setActor(ids.reader);await deny(()=>docs('save-bulk',{...revise(),entryIds:[doc.entries[0].id],fieldKey:'COD_DESTINO',value:'1'}),'42501');
  await deny(()=>db.query("UPDATE public.billing_import_entry_values SET text_value='1' WHERE entry_id=$1",[doc.entries[0].id]),'42501');
  await setActor(null);await deny(()=>docs('reopen',revise()),'28000');
 }finally{await db.close();}
});

test('live SQL regression uses ephemeral identities and rolls all fixtures back',async()=>{
 const {db}=await createCaneWeighingDb();
 try{
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL('../supabase/tests/import_linked_edits.sql',import.meta.url),'utf8'));
  assert.equal((await db.query("SELECT count(*)::int n FROM auth.users WHERE email LIKE 'linked-edits%@example.invalid'")).rows[0].n,0);
 }finally{await db.close();}
});
