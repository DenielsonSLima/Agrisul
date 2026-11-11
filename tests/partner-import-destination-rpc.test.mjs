import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('partner destination defaults fill imports through RPC, preserving explicit cells, snapshots and tenant isolation',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const deny=(fn,code)=>assert.rejects(fn,error=>error.code===code);
 const clientInput={legalName:'TAQUARI',tradeName:'',cnpj:'00000000000000',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:''};
 const field=(key,column)=>({key,column,type:'decimal',label:key,source:'manual',sourceKey:'',required:false,defaultValue:'',mappings:{},pattern:''});
 const model={name:'Destino por parceiro',clientId:null,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[field('PESOBRUTO','AA'),field('TARA','AB')]};
 const row=(trip,sequence,destination='')=>({date:'2026-11-06',source:{entrada:trip,sequencia:String(sequence),dataMovimento:'2026-11-06',numeroAnalise:trip+sequence},sourcePage:1,sourceLine:'Pesagem original',values:{PESOBRUTO:'10',TARA:'1',COD_DESTINO:destination}});
 const upload=(profile,clientId,hash,entries)=>rpc('import-documents','import',{profileId:profile.id,clientId,sourceName:'Boletim.pdf',sourceHash:hash.repeat(64),entries});
 try{
  const p=(await rpc('import-profiles','save',model)).profile;
  const second=(await rpc('clients','save',{...clientInput,legalName:'PINHEIRO',cnpj:'12345678000195'})).client;
  let doc=(await upload(p,ids.partner,'a',[row('101',1),row('101',2,'00042')])).document;
  const unrelated=(await upload(p,second.id,'b',[row('102',1)])).document;
  for(const entry of doc.entries)doc=(await rpc('import-documents','save-entry',{id:doc.id,entryId:entry.id,date:entry.date,values:entry.values,reviewed:true,expectedUpdatedAt:doc.updatedAt})).document;
  doc=(await rpc('import-documents','finalize',{id:doc.id,expectedUpdatedAt:doc.updatedAt})).document;
  const before=structuredClone(doc);

  await setActor(ids.otherOwner);
  const foreignProfile=(await rpc('import-profiles','save',model)).profile;
  const foreignDoc=(await upload(foreignProfile,ids.otherPartner,'c',[row('201',1)])).document;
  await setActor();
  const saved=(await rpc('clients','save',{...clientInput,id:ids.partner,destinationCode:'8'})).client;
  assert.equal(saved.destinationCode,'8');assert.equal('destination_code' in saved,false);
  assert.equal((await rpc('clients','get',{id:ids.partner})).client.destinationCode,'8');
  assert.equal((await rpc('clients','list')).clients.find(c=>c.id===ids.partner).destinationCode,'8');
  doc=(await rpc('import-documents','get',{id:doc.id})).document;
  assert.equal(doc.status,'finished');assert.notEqual(doc.updatedAt,before.updatedAt);
  assert.equal(doc.entries[0].values.COD_DESTINO,'8');assert.equal(doc.entries[0].reviewed,false);
  assert.equal(doc.entries[1].values.COD_DESTINO,'00042');assert.equal(doc.entries[1].reviewed,true);
  assert.deepEqual(doc.entries.map(e=>e.id),before.entries.map(e=>e.id));
  assert.deepEqual(doc.entries.map(e=>e.source),before.entries.map(e=>e.source));
  assert.deepEqual(doc.profileSnapshot,before.profileSnapshot);
  assert.equal((await rpc('import-documents','get',{id:unrelated.id})).document.entries[0].values.COD_DESTINO,'');
  const exported=await rpc('import-documents','export',{id:doc.id});
  assert.equal(exported.columns.find(c=>c.key==='COD_DESTINO').type,'text');assert.deepEqual(exported.rows.map(r=>r.values.AC),['8','00042']);
  await deny(()=>rpc('import-documents','save-bulk',{id:doc.id,expectedUpdatedAt:before.updatedAt,entryIds:[doc.entries[0].id],fieldKey:'COD_DESTINO',value:'9'}),'PT409');

  const next=(await upload(p,ids.partner,'d',[row('103',1)])).document;
  assert.equal(next.entries[0].values.COD_DESTINO,'8');
  const repeated=await upload(p,ids.partner,'d',[row('103',1,'99')]);assert.equal(repeated.created,false);assert.equal(repeated.document.entries[0].values.COD_DESTINO,'8');
  const manual=(await rpc('import-documents','save-entry',{id:next.id,date:'2026-11-06',values:{PESOBRUTO:'5',TARA:'1'},reviewed:false,expectedUpdatedAt:next.updatedAt})).document;
  assert.equal(manual.entries.at(-1).values.COD_DESTINO,'8');
  const oldBundle=(await rpc('clients','save',{...clientInput,id:ids.partner,tradeName:'Nome atualizado'})).client;
  assert.equal(oldBundle.destinationCode,'8','Old bundles that omit the field preserve its value');
  for(const destinationCode of [19,null,'A19','19.0','1'.repeat(31)])await deny(()=>rpc('clients','save',{...clientInput,id:ids.partner,destinationCode}),'22023');
  assert.equal((await rpc('clients','get',{id:ids.partner})).client.destinationCode,'8');

  const pinClient=(await rpc('clients','save',{...clientInput,legalName:'PINHEIRO',cnpj:'12345678000195',id:second.id,destinationCode:'00019'})).client;
  assert.equal(pinClient.destinationCode,'00019');
  assert.equal((await rpc('import-documents','get',{id:unrelated.id})).document.entries[0].values.COD_DESTINO,'00019');
  const pin=(await rpc('import-profiles','save',{...model,name:'Pinheiro com destino',parser:'pinheiro-usjp-v1'})).profile;
  const pinRow=number=>({date:'2026-11-08',source:{periodoInicio:'2026-11-08T06:00',periodoFim:'2026-11-09T05:59',dataHoraBA:'2026-11-08T07:00',dataHoraTara:'2026-11-08T07:20',numeroAnalise:number,pesoAnalisado:'9'},sourcePage:1,sourceLine:'BA original',values:{PESOBRUTO:'10',TARA:'1'}});
  let pinDoc=(await upload(pin,second.id,'e',[pinRow('11213')])).document;
  assert.equal(pinDoc.entries[0].values.COD_DESTINO,'00019');
  pinDoc=(await rpc('import-documents','append-source-entries',{id:pinDoc.id,expectedUpdatedAt:pinDoc.updatedAt,entries:[pinRow('11214')]})).document;
  assert.deepEqual(pinDoc.entries.map(e=>e.values.COD_DESTINO),['00019','00019']);
  const cleared=(await rpc('clients','save',{...clientInput,id:ids.partner,destinationCode:''})).client;assert.equal(cleared.destinationCode,'');
  assert.equal((await rpc('import-documents','get',{id:doc.id})).document.entries[0].values.COD_DESTINO,'8','Clearing a default does not erase historical values');

  await deny(()=>db.query("update public.billing_clients set destination_code='99' where id=$1",[ids.partner]),'42501');
  await deny(()=>db.query('select billing_private.import_fill_partner_destination($1,$2)',[ids.owner,doc.id]),'42501');
  await setActor(ids.otherOwner);
  assert.equal((await rpc('import-documents','get',{id:foreignDoc.id})).document.entries[0].values.COD_DESTINO,'');
  await deny(()=>rpc('clients','save',{...clientInput,id:ids.partner,destinationCode:'99'}),'P0002');
  await setActor(ids.reader);await deny(()=>rpc('clients','save',{...clientInput,id:ids.partner,destinationCode:'99'}),'42501');
  await setActor(null);await deny(()=>rpc('clients','save',{...clientInput,id:ids.partner,destinationCode:'99'}),'28000');
 }finally{await db.close();}
});
