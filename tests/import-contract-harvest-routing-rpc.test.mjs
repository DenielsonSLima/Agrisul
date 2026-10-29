import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('column K routes finished PDF sets by contract harvest type and rejects cross-type linking',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 try{
  await db.exec('RESET ROLE');
  const farm=(await db.query(`INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,'Origem por colheita',100,'Capela','SE') RETURNING id`,[ids.owner])).rows[0].id;
  const type=(await db.query(`INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Tipo renomeado','[]') RETURNING id`,[ids.owner])).rows[0].id;
  assert.deepEqual((await db.query(`SELECT billing_private.contract_import_harvest_method(name) method FROM (VALUES ('MANUAL'),('Contrato Mecanizado'),('Mecanizada'),('MACANIZADO'),('Manual e Mecanizado'),('Cana')) names(name)`)).rows.map(row=>row.method),['1','2','2','2',null,null]);
  const contracts={};
  for(const [key,name] of [['manual','MANUAL'],['mechanized','MACANIZADO'],['generic','Cana']]){
   contracts[key]=(await db.query(`INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,$2,$3,$4,$5,$2,'[]','Ativo','2026-10-01',1000) RETURNING id`,[ids.owner,name,ids.company,ids.partner,type])).rows[0].id;
  }
  await setActor();
  const field=(key,column,type='text')=>({key,column,type,label:key,source:'manual',sourceKey:'',required:false,defaultValue:'',mappings:{},pattern:''});
  const profile=(await rpc('import-profiles','save',{name:'Roteamento K',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[field('COD_ENTRADA','L','decimal'),field('COD_TIPOCOLHEITA','K'),field('COD_FAZENDA','F'),field('COD_TALHAO','H'),field('PESOBRUTO','AA','decimal'),field('TARA','AB','decimal')]})).profile;
  const row=(entry,method,gross)=>({date:'2026-10-29',source:{entrada:entry,sequencia:'1',dataMovimento:'2026-10-29'},values:{COD_ENTRADA:entry,COD_TIPOCOLHEITA:method,COD_FAZENDA:'5032',COD_TALHAO:'8',PESOBRUTO:gross,TARA:'1'},sourcePage:1,sourceLine:'Colheita do conjunto'});
  let document=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'roteamento.pdf',sourceHash:'c'.repeat(64),entries:[row('1150','2','21.125'),row('1151','1','31.5'),row('1152','9','11')]})).document;
  document=(await docs('finalize',{id:document.id,expectedUpdatedAt:document.updatedAt})).document;
  const scope=key=>({companyId:ids.company,contractId:contracts[key]});
  const manual=(await docs('pending-loads',scope('manual'))).loads;
  const mechanized=(await docs('pending-loads',scope('mechanized'))).loads;
  assert.deepEqual(manual.map(item=>item.entryNumber).sort(),['1151','1152']);
  assert.deepEqual(mechanized.map(item=>item.entryNumber).sort(),['1150','1152']);
  assert.equal((await docs('pending-loads',scope('generic'))).loads.length,3,'Unclassified contract types preserve existing behavior');
  assert.match(manual.find(item=>item.entryNumber==='1152').issue,/coluna K/);
  const machine=mechanized.find(item=>item.entryNumber==='1150'),hand=manual.find(item=>item.entryNumber==='1151');
  const link=(key,candidate)=>docs('link-load',{...scope(key),id:document.id,expectedUpdatedAt:document.updatedAt,tripKey:candidate.tripKey,farmId:farm,plotId:''});
  for(const [key,candidate] of [['manual',machine],['mechanized',hand]]){
   await assert.rejects(()=>link(key,candidate),error=>error.code==='23514'&&/coluna K/.test(error.message));
  }
  const linkedMachine=await link('mechanized',machine),linkedManual=await link('manual',hand);
  assert.equal(linkedMachine.load.volume,'20.125');assert.equal(linkedManual.load.volume,'30.5');
  assert.equal((await link('mechanized',machine)).created,false);
  await assert.rejects(()=>link('manual',machine),error=>error.code==='23514');
  assert.equal((await docs('pending-loads',scope('manual'))).loads.length,1);
  await setActor(ids.reader);assert.equal((await docs('pending-loads',scope('mechanized'))).loads.length,1);
  await assert.rejects(()=>link('manual',hand),error=>error.code==='42501');
  await setActor(ids.otherOwner);await assert.rejects(()=>docs('pending-loads',scope('manual')),error=>error.code==='P0002');
  await setActor(null);await assert.rejects(()=>docs('pending-loads',scope('manual')),error=>error.code==='28000');
 }finally{await db.close();}
});
