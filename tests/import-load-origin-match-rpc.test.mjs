import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('finished PDF origins suggest only unique registered codes within the owner and farm',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const farm=async(owner,code,name)=>(await db.query(`INSERT INTO public.billing_farms(owner_id,code,name,area_ha,city,state) VALUES($1,$2,$3,100,'Capela','SE') RETURNING id`,[owner,code,name])).rows[0].id;
 const plot=async(owner,farmId,name)=>(await db.query(`INSERT INTO public.billing_farm_plots(owner_id,farm_id,name,area_ha) VALUES($1,$2,$3,10) RETURNING id`,[owner,farmId,name])).rows[0].id;
 try{
  await db.exec('RESET ROLE');
  const varzea=await farm(ids.owner,'5030','VAZEA VERDE'),tapera=await farm(ids.owner,'5032','TAPERA');
  const varzea3=await plot(ids.owner,varzea,'03'),tapera8=await plot(ids.owner,tapera,'08');
  await plot(ids.owner,tapera,'52');
  const letters=await farm(ids.owner,'00A','Código literal'),letterPlot=await plot(ids.owner,letters,'A1');
  await farm(ids.owner,'00a','Outro código literal');
  const foreign=await farm(ids.otherOwner,'5030','Outra conta');await plot(ids.otherOwner,foreign,'03');
  const type=(await db.query(`INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'MANUAL','[]') RETURNING id`,[ids.owner])).rows[0].id;
  const contract=(await db.query(`INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Origens cadastradas',$2,$3,$4,'MANUAL','[]','Ativo','2026-10-01',1000) RETURNING id`,[ids.owner,ids.company,ids.partner,type])).rows[0].id;
  await setActor();
  const field=(key,column,type='text')=>({key,column,type,label:key,source:'manual',sourceKey:'',required:false,defaultValue:'',mappings:{},pattern:''});
  const profile=(await rpc('import-profiles','save',{name:'Origens por código',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[field('COD_ENTRADA','L'),field('COD_TIPOCOLHEITA','K'),field('COD_FAZENDA','F'),field('COD_TALHAO','H'),field('PESOBRUTO','AA','decimal'),field('TARA','AB','decimal')]})).profile;
  const row=(entry,farmCode,plotCode)=>({date:'2026-10-29',source:{entrada:entry,sequencia:'1',dataMovimento:'2026-10-29'},values:{COD_ENTRADA:entry,COD_TIPOCOLHEITA:'1',COD_FAZENDA:farmCode,COD_TALHAO:plotCode,PESOBRUTO:'21.125',TARA:'1'},sourcePage:1,sourceLine:'Origem do conjunto'});
  let document=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'origens.pdf',sourceHash:'d'.repeat(64),entries:[row('1','5030','3'),row('2','5032','8'),row('3','5030','52'),row('4','9999','3'),row('5','',''),row('6','00A','A1'),row('7','5.030','3')]})).document;
  document=(await docs('finalize',{id:document.id,expectedUpdatedAt:document.updatedAt})).document;
  const scope={companyId:ids.company,contractId:contract};
  const queue=async()=>Object.fromEntries((await docs('pending-loads',scope)).loads.map(item=>[item.entryNumber,item]));
  let items=await queue();
  assert.deepEqual([items['1'].matchedFarmId,items['1'].matchedPlotId,items['1'].farmMatchStatus,items['1'].plotMatchStatus],[varzea,varzea3,'matched','matched']);
  assert.deepEqual([items['2'].matchedFarmId,items['2'].matchedPlotId],[tapera,tapera8]);
  assert.deepEqual([items['3'].matchedFarmId,items['3'].matchedPlotId,items['3'].plotMatchStatus],[varzea,null,'not-found'],'A plot in another farm is never selected');
  assert.deepEqual([items['4'].matchedFarmId,items['4'].farmMatchStatus,items['4'].plotMatchStatus],[null,'not-found','unresolved-farm']);
  assert.deepEqual([items['5'].farmMatchStatus,items['5'].plotMatchStatus],['missing-code','missing-code']);
  assert.deepEqual([items['6'].matchedFarmId,items['6'].matchedPlotId],[letters,letterPlot],'Alphanumeric codes remain literal');
  assert.equal(items['7'].farmMatchStatus,'not-found','Punctuation does not imply a numeric identifier');
  await db.exec('RESET ROLE');await plot(ids.owner,varzea,'003');await setActor();
  items=await queue();assert.equal(items['1'].matchedFarmId,varzea);assert.equal(items['1'].matchedPlotId,null);assert.equal(items['1'].plotMatchStatus,'ambiguous');
  await db.exec('RESET ROLE');await farm(ids.owner,'05030','Código equivalente duplicado');await setActor();
  items=await queue();assert.deepEqual([items['1'].matchedFarmId,items['1'].matchedPlotId,items['1'].farmMatchStatus,items['1'].plotMatchStatus],[null,null,'ambiguous','unresolved-farm']);
  await assert.rejects(()=>db.query('SELECT * FROM billing_private.import_load_origin_match($1,$2,$3)',[ids.otherOwner,'5030','3']),error=>error.code==='42501');
  const linked=await docs('link-load',{...scope,id:document.id,tripKey:items['2'].tripKey,expectedUpdatedAt:document.updatedAt,farmId:varzea,plotId:''});
  assert.equal(linked.load.farmId,varzea,'An explicit valid manual choice remains permitted');
  assert.equal(linked.load.volume,'20.125');
  await setActor(ids.reader);assert.equal((await queue())['6'].matchedFarmId,letters);
  await setActor(ids.otherOwner);await assert.rejects(()=>docs('pending-loads',scope),error=>error.code==='P0002');
  await setActor(null);await assert.rejects(()=>docs('pending-loads',scope),error=>error.code==='28000');
 }finally{await db.close();}
});
