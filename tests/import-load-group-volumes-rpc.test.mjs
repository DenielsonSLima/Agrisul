import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('pending PDF origins retain the exact complete source-set net volume and ordinal after a partial link',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 try{
  await db.exec('RESET ROLE');
  const farm=(await db.query(`INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,'Origem conjunto',100,'Capela','SE') RETURNING id`,[ids.owner])).rows[0].id;
  const type=(await db.query(`INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Manual','[]') RETURNING id`,[ids.owner])).rows[0].id;
  const contract=(await db.query(`INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Manual conjunto',$2,$3,$4,'Manual','[]','Ativo','2026-10-01',1000) RETURNING id`,[ids.owner,ids.company,ids.partner,type])).rows[0].id;
  await setActor();
  const field=(key,column,type='text')=>({key,column,type,label:key,source:'manual',sourceKey:'',required:false,defaultValue:'',mappings:{},pattern:''});
  const profile=(await rpc('import-profiles','save',{name:'Volumes por conjunto',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[field('COD_ENTRADA','L','decimal'),field('COD_TIPOCOLHEITA','K'),field('COD_FAZENDA','F'),field('COD_TALHAO','H'),field('PESOBRUTO','AA','decimal'),field('TARA','AB','decimal')]})).profile;
  const row=(trip,seq,plot,gross)=>({date:'2026-10-27',source:{entrada:trip,sequencia:String(seq),dataMovimento:'2026-10-27'},values:{COD_ENTRADA:trip,COD_TIPOCOLHEITA:'1',COD_FAZENDA:'5010',COD_TALHAO:plot,PESOBRUTO:gross,TARA:'1'},sourcePage:1,sourceLine:'PDF conjunto'});
  let document=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'group-volumes.pdf',sourceHash:'c'.repeat(64),entries:[row('3394',1,'54','21.125'),row('3394',2,'54','11.375'),row('3394',3,'55','6'),row('3404',1,'54','9'),row('3405',1,'54','9'),row('3405',2,'54','')]})).document;
  document=(await docs('finalize',{id:document.id,expectedUpdatedAt:document.updatedAt})).document;
  const scope={companyId:ids.company,contractId:contract};
  const queue=(await docs('pending-loads',scope)).loads;
  assert.equal(queue.length,4);
  const parts=queue.filter(item=>item.entryNumber==='3394');
  assert.equal(parts.length,2);
  assert.deepEqual(parts.map(p=>[p.plotCode,p.volume,p.groupVolume,p.groupEntryCount,p.groupOriginCount,p.groupOrdinal]).sort(),[
   ['54','30.5','35.5',3,2,1],['55','5','35.5',3,2,1],
  ]);
  assert.ok(parts.every(part=>part.groupKey===document.entries[0].groupKey));
  const single=queue.find(p=>p.entryNumber==='3404');
  assert.equal(single.groupKey,single.tripKey);
  assert.equal(single.groupVolume,'8');assert.equal(single.volume,'8');
  assert.equal(single.groupOrdinal,2);assert.equal(single.groupOriginCount,1);assert.equal(single.groupEntryCount,1);
  const incomplete=queue.find(p=>p.entryNumber==='3405');
  assert.equal(incomplete.groupVolume,null,'Never show a partial sum as a complete set volume');
  assert.equal(incomplete.groupEntryCount,2);assert.match(incomplete.issue,/pesos/);
  const payload={...scope,id:document.id,expectedUpdatedAt:document.updatedAt,tripKey:parts[0].tripKey,farmId:farm,plotId:''};
  const first=await docs('link-load',payload);
  assert.equal(first.load.volume,parts[0].volume,'Link uses only the selected origin volume');
  assert.equal((await docs('link-load',payload)).created,false);
  const remaining=(await docs('pending-loads',scope)).loads.find(p=>p.entryNumber==='3394');
  assert.equal(remaining.groupVolume,'35.5','Complete source volume survives removal of the linked origin');
  assert.equal(remaining.groupEntryCount,3);assert.equal(remaining.groupOriginCount,2);assert.equal(remaining.groupOrdinal,1);
  const second=await docs('link-load',{...payload,tripKey:remaining.tripKey});
  assert.equal(Number(first.load.volume)+Number(second.load.volume),35.5,'Repeated group total is never persisted twice');
  assert.equal((await docs('pending-loads',scope)).loads.some(p=>p.entryNumber==='3394'),false);
  await setActor(ids.otherOwner);
  await assert.rejects(()=>docs('pending-loads',scope),error=>error.code==='P0002');
  await setActor(ids.reader);
  assert.equal((await docs('pending-loads',scope)).loads.find(p=>p.entryNumber==='3404').groupVolume,'8');
  await assert.rejects(()=>db.query('SELECT * FROM billing_private.import_load_group_summary(NULL::public.billing_import_documents)'),error=>error.code==='42501');
 }finally{await db.close();}
});
