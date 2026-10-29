import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('finished PDF groups link once to the matching contract with exact tonne volume, harvest method and pending ATR',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const deny=(fn,code)=>assert.rejects(fn,error=>error.code===code);
 try{
  await db.exec('RESET ROLE');
  const farm=(await db.query(`INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,'Origem PDF',100,'Cuiabá','MT') RETURNING id`,[ids.owner])).rows[0].id;
  const type=(await db.query(`INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Cana teste','[]') RETURNING id`,[ids.owner])).rows[0].id;
  const contract=(await db.query(`INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Contrato safra',$2,$3,$4,'Cana','[]','Ativo','2026-10-01',1000) RETURNING id`,[ids.owner,ids.company,ids.partner,type])).rows[0].id;
  await setActor();
  const field=(key,column,type='text')=>({key,column,type,label:key,source:'manual',sourceKey:'',required:false,defaultValue:'',mappings:{},pattern:''});
  const profile=(await rpc('import-profiles','save',{name:'Fila PDF',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[field('COD_ENTRADA','L','decimal'),field('COD_TIPOCOLHEITA','K'),field('COD_FAZENDA','F'),field('COD_TALHAO','H'),field('PESOBRUTO','AA','decimal'),field('TARA','AB','decimal')]})).profile;
  const row=(group,seq,method,gross,tare)=>({date:'2026-10-22',source:{entrada:group,sequencia:String(seq),dataMovimento:'2026-10-22'},values:{COD_ENTRADA:group,COD_TIPOCOLHEITA:method,COD_FAZENDA:'5010',COD_TALHAO:'54',PESOBRUTO:gross,TARA:tare},sourcePage:1,sourceLine:'Evidence'});
  let document=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'fila.pdf',sourceHash:'a'.repeat(64),entries:[row('101',1,'1','20.125','1'),row('101',2,'1','10.375','1'),row('102',1,'2','25','1'),row('103',1,'9','12','1'),row('104',1,'2','','1')]})).document;
  const scope={companyId:ids.company,contractId:contract};
  assert.deepEqual((await docs('pending-loads',scope)).loads,[]);
  document=(await docs('finalize',{id:document.id,expectedUpdatedAt:document.updatedAt})).document;
  const pending=(await docs('pending-loads',scope)).loads;
  assert.equal(pending.length,4);const manual=pending.find(load=>load.entryNumber==='101'),machine=pending.find(load=>load.entryNumber==='102');
  assert.equal(manual.entryCount,2);assert.equal(manual.volume,'28.5');assert.equal(manual.harvestMethod,'1');assert.equal(machine.volume,'24');assert.equal(machine.harvestMethod,'2');
  assert.match(pending.find(load=>load.entryNumber==='103').issue,/coluna K/);assert.match(pending.find(load=>load.entryNumber==='104').issue,/pesos/);
  const payload={...scope,id:document.id,tripKey:manual.tripKey,expectedUpdatedAt:document.updatedAt,farmId:farm,plotId:''};
  await deny(()=>docs('link-load',{...payload,expectedUpdatedAt:'2020-01-01'}),'40001');
  await deny(()=>docs('link-load',{...payload,ownerId:ids.otherOwner}),'22023');
  const first=await docs('link-load',payload);assert.equal(first.created,true);assert.equal(first.load.volume,'28.5');assert.equal(first.load.atr,'');
  assert.equal((await docs('link-load',payload)).load.id,first.load.id,'Retry does not duplicate the trip');assert.equal((await docs('link-load',payload)).created,false);
  assert.equal((await docs('pending-loads',scope)).loads.length,3);
  await deny(()=>docs('reopen',{id:document.id,expectedUpdatedAt:document.updatedAt}),'23514');
  const saved=await rpc('contracts','save-load',{...scope,id:first.load.id,loadedAt:first.load.loadedAt,farmId:farm,plotId:'',volume:first.load.volume,atr:'',document:'101',notes:'ATR depois'});
  assert.equal(saved.load.atr,'');
  const priced=await rpc('contracts','save-load',{...scope,id:first.load.id,loadedAt:first.load.loadedAt,farmId:farm,plotId:'',volume:first.load.volume,atr:'121.234567',document:'101',notes:''});assert.equal(priced.load.atr,'121.234567');
  const detail=await rpc('contracts','get',{id:contract,companyId:ids.company});assert.equal(detail.contract.loadedVolume,'28.5');
  assert.equal((await db.query('SELECT harvest_method FROM public.billing_contract_loads WHERE id=$1',[first.load.id])).rows[0].harvest_method,'1');
  const mechanized=await docs('link-load',{...payload,tripKey:machine.tripKey});
  const historical=await rpc('contracts','save-load',{...scope,loadedAt:'2026-10-21',farmId:farm,plotId:'',volume:'3.125',atr:'',document:'Histórico',notes:''});
  const dashboardScope={companyId:ids.company,from:'2026-10-01',to:'2026-10-31'};
  const dashboard=await rpc('summary','dashboard',dashboardScope);const methods=Object.fromEntries(dashboard.harvestMethods.map(method=>[method.code,method]));
  assert.equal(methods['1'].loadCount,1);assert.equal(Number(methods['1'].loadedVolume),28.5);assert.equal(methods['2'].loadCount,1);assert.equal(Number(methods['2'].loadedVolume),24);assert.equal(methods.unknown.loadCount,1);assert.equal(Number(methods.unknown.loadedVolume),3.125);
  assert.equal((await rpc('summary','dashboard',{...dashboardScope,from:'2026-10-22',to:'2026-10-22'})).harvestMethods.find(method=>method.code==='unknown').loadCount,0);
  assert.equal((await rpc('summary','dashboard',{...dashboardScope,status:'Concluído'})).harvestMethods.every(method=>method.loadCount===0),true);
  assert.equal((await rpc('summary','dashboard',{...dashboardScope,companyId:ids.siblingCompany})).harvestMethods.every(method=>method.loadCount===0),true);
  assert.equal((await rpc('summary','dashboard',{...dashboardScope,contractId:contract})).harvestMethods.find(method=>method.code==='2').loadCount,1);
  await deny(()=>db.query('DELETE FROM public.billing_import_load_links WHERE document_id=$1',[document.id]),'42501');
  await setActor(ids.reader);assert.equal((await docs('pending-loads',scope)).loads.length,2);await deny(()=>docs('link-load',{...payload,tripKey:machine.tripKey}),'42501');
  await setActor(ids.otherOwner);await deny(()=>docs('pending-loads',scope),'P0002');await deny(()=>docs('link-load',payload),'P0002');
  await deny(()=>rpc('summary','dashboard',dashboardScope),'22023');
  assert.equal((await db.query('SELECT count(*)::int n FROM public.billing_import_load_links')).rows[0].n,0);
  await setActor(null);await deny(()=>docs('pending-loads',scope),'28000');
  await setActor();await rpc('contracts','delete-load',{...scope,id:first.load.id});await rpc('contracts','delete-load',{...scope,id:mechanized.load.id});await rpc('contracts','delete-load',{...scope,id:historical.load.id});assert.equal((await docs('pending-loads',scope)).loads.length,4,'Deleting the contract load returns the source trip to the queue');
  document=(await docs('reopen',{id:document.id,expectedUpdatedAt:document.updatedAt})).document;assert.equal(document.status,'open');assert.equal((await docs('pending-loads',scope)).loads.length,0);
 }finally{await db.close();}
});

test('mixed-origin trips split into exact idempotent plot loads without changing single-origin trip keys',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 try{
  await db.exec('RESET ROLE');
  const farm=(await db.query(`INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,'Origem múltipla',100,'Capela','SE') RETURNING id`,[ids.owner])).rows[0].id;
  const type=(await db.query(`INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Origens PDF','[]') RETURNING id`,[ids.owner])).rows[0].id;
  const contract=(await db.query(`INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Safra por origem',$2,$3,$4,'Cana','[]','Ativo','2026-10-01',1000) RETURNING id`,[ids.owner,ids.company,ids.partner,type])).rows[0].id;
  await setActor();
  const a=(await rpc('plots','save',{farmId:farm,name:'54',areaHa:'20'})).data.plots.find(p=>p.name==='54').id;
  const b=(await rpc('plots','save',{farmId:farm,name:'55',areaHa:'20'})).data.plots.find(p=>p.name==='55').id;
  const field=(key,column,type='text')=>({key,column,type,label:key,source:'manual',sourceKey:'',required:false,defaultValue:'',mappings:{},pattern:''});
  const profile=(await rpc('import-profiles','save',{name:'Viagens com duas origens',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[field('COD_ENTRADA','L','decimal'),field('COD_TIPOCOLHEITA','K'),field('COD_FAZENDA','F'),field('COD_TALHAO','H'),field('PESOBRUTO','AA','decimal'),field('TARA','AB','decimal')]})).profile;
  const row=(trip,seq,plot,gross)=>({date:'2026-10-27',source:{entrada:trip,sequencia:String(seq),dataMovimento:'2026-10-27'},values:{COD_ENTRADA:trip,COD_TIPOCOLHEITA:'1',COD_FAZENDA:'5010',COD_TALHAO:plot,PESOBRUTO:gross,TARA:'1'},sourcePage:1,sourceLine:'PDF com origem por compartimento'});
  let document=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'mixed-origins.pdf',sourceHash:'b'.repeat(64),entries:[row('3394',1,'54','21.125'),row('3394',2,'54','11.375'),row('3394',3,'55','6'),row('3404',1,'54','9')]})).document;
  document=(await docs('finalize',{id:document.id,expectedUpdatedAt:document.updatedAt})).document;
  const scope={companyId:ids.company,contractId:contract},queue=(await docs('pending-loads',scope)).loads;
  assert.equal(queue.length,3);
  const parts=queue.filter(item=>item.entryNumber==='3394');assert.equal(parts.length,2);assert.equal(new Set(parts.map(p=>p.tripKey)).size,2);
  assert.ok(parts.every(part=>part.issue===''&&part.tripKey.includes('|origin:')));
  assert.deepEqual(parts.map(p=>[p.plotCode,p.entryCount,p.volume]).sort(),[['54',2,'30.5'],['55',1,'5']]);
  assert.equal(queue.find(p=>p.entryNumber==='3404').tripKey,document.entries[3].groupKey);
  for(const part of parts){const payload={...scope,id:document.id,expectedUpdatedAt:document.updatedAt,tripKey:part.tripKey,farmId:farm,plotId:part.plotCode==='54'?a:b};const saved=await docs('link-load',payload);assert.equal(saved.created,true);assert.equal(saved.load.atr,'');assert.equal(saved.load.plotId,payload.plotId);assert.equal((await docs('link-load',payload)).created,false);}
  const remaining=(await docs('pending-loads',scope)).loads;assert.equal(remaining.length,1);assert.equal(remaining[0].entryNumber,'3404');
  const saved=await rpc('contracts','get',{companyId:ids.company,id:contract});assert.match(saved.contract.loadedVolume,/^35\.50*$/);
  const summary=await rpc('summary','dashboard',{companyId:ids.company,from:'2026-10-27',to:'2026-10-27'});assert.match(summary.harvestMethods[0].loadedVolume,/^35\.50*$/);
 }finally{await db.close();}
});
