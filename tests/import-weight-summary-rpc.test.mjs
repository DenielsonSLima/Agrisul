import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('screen weight summaries use current NUMERIC cells and original trips within the exact visible filters',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const field=(key,column,type='text')=>({key,column,type,label:key,source:'manual',sourceKey:'',required:false,defaultValue:'',mappings:{},pattern:''});
 const fields=[field('COD_ENTRADA','L','decimal'),field('COD_EQUIPAMENTO_TRANSPORTE','S'),field('PESOBRUTO','AA','decimal'),field('TARA','AB','decimal'),field('MARKER','A')];
 const metricKeys=['entryCount','tripCount','grossWeight','netWeight','grossMissingCount','netMissingCount'];
 const metrics=value=>Object.fromEntries(metricKeys.map(key=>[key,value[key]]));
 const expected=(entryCount,tripCount,grossWeight,netWeight,grossMissingCount,netMissingCount)=>({entryCount,tripCount,grossWeight,netWeight,grossMissingCount,netMissingCount});
 const codes=row=>[...row.equipmentCodes].sort();
 const equipment=(summary,status,equipmentCodes)=>summary.equipment.find(row=>row.status===status&&JSON.stringify(codes(row))===JSON.stringify([...equipmentCodes].sort()));
 try{
  const profile=(await rpc('import-profiles','save',{name:'Taquari current-cell weight summary',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields})).profile;
  const row=(group,sequence,gross,tare,code,marker)=>({date:'2026-10-22',source:{dataMovimento:'2026-10-22',entrada:group,sequencia:String(sequence),equipamento:'999999',pesoBruto:'999',tara:'998',pesoLiquido:'1'},values:{COD_ENTRADA:'700',COD_EQUIPAMENTO_TRANSPORTE:code,PESOBRUTO:gross,TARA:tare,MARKER:marker},sourcePage:1,sourceLine:`Original ${group}/${sequence}`});
  let document=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'screen-weights.pdf',sourceHash:createHash('sha256').update('screen-weights').digest('hex'),entries:[
   row('1000',1,'123456789012345.123456','0.123456','000123','KEEP'),row('1000',2,'2','1','000123','DROP'),
   row('2000',1,'3','1','000456','KEEP'),row('2000',2,'','1','000456','MISSING'),row('2000',3,'5','','000456','DROP'),
  ]})).document;
  const table=(filters={})=>docs('table',{id:document.id,...filters});
  const edit=async(index,changes)=>{const entry=document.entries[index];document=(await docs('save-entry',{id:document.id,entryId:entry.id,date:entry.date,values:{...entry.values,...changes},reviewed:false,expectedUpdatedAt:document.updatedAt})).document;};
  const firstGroup=document.entries[0].groupKey,secondGroup=document.entries[2].groupKey;
  const sourceBefore=structuredClone(document.entries.map(entry=>entry.source));
  const exportBefore=await docs('export',{id:document.id});
  const all=(await table()).weightSummary;
  assert.deepEqual(metrics(all),expected(5,2,'123456789012355.123456','123456789012348',1,2),'Exact decimal sums never pass through floating point and never use source weight fallbacks');
  assert.equal(all.equipmentCount,2);assert.equal(all.unlinkedEntryCount,0);assert.equal(all.partialTripCount,0);
  assert.deepEqual(all.groupSizes,[{entryCount:2,tripCount:1},{entryCount:3,tripCount:1}]);
  assert.equal(all.trips.length,2);assert.notEqual(firstGroup,secondGroup);
  for(const [key,total] of [[firstGroup,2],[secondGroup,3]]){
   const trip=all.trips.find(trip=>trip.key===key);assert.ok(trip);assert.equal(trip.totalEntryCount,total);assert.equal(trip.entryCount,total);assert.equal(trip.tripCount,1);assert.equal(trip.partial,false);assert.equal(trip.linked,true);assert.equal(trip.date,'2026-10-22');assert.deepEqual(trip.entryNumbers,['700'],'Repeated destination entry numbers do not merge different original trips');
  }
  assert.deepEqual(metrics(equipment(all,'assigned',['000123'])),expected(2,1,'123456789012347.123456','123456789012346',0,0));
  assert.deepEqual(metrics(equipment(all,'assigned',['000456'])),expected(3,1,'8','2',1,2));
  assert.equal(all.equipment.some(row=>row.equipmentCodes.includes('999999')),false,'Equipment assignment uses destination cells, not source codes');

  const keepFilters={columnFilters:{MARKER:['KEEP']},sortKey:'PESOBRUTO',sortDirection:'desc'};
  const keep=await table(keepFilters),partial=keep.weightSummary;
  assert.deepEqual(metrics(partial),expected(2,2,'123456789012348.123456','123456789012347',0,0));
  assert.equal(partial.partialTripCount,2);assert.deepEqual(partial.groupSizes,all.groupSizes,'Group sizes describe the complete original trips, not surviving filtered rows');
  for(const [key,total] of [[firstGroup,2],[secondGroup,3]]){
   const trip=partial.trips.find(trip=>trip.key===key);assert.equal(trip.entryCount,1);assert.equal(trip.totalEntryCount,total);assert.equal(trip.partial,true);
  }
  const missing=(await table({columnFilters:{MARKER:['MISSING']}})).weightSummary;
  assert.deepEqual(metrics(missing),expected(1,1,null,null,1,1));
  assert.equal(missing.partialTripCount,1);assert.deepEqual(missing.groupSizes,[{entryCount:3,tripCount:1}]);
  const empty=(await table({columnFilters:{MARKER:[]}})).weightSummary;
  assert.deepEqual(metrics(empty),expected(0,0,'0','0',0,0));assert.equal(empty.equipmentCount,0);assert.equal(empty.unlinkedEntryCount,0);assert.equal(empty.partialTripCount,0);assert.deepEqual(empty.equipment,[]);assert.deepEqual(empty.trips,[]);assert.deepEqual(empty.groupSizes,[]);

  const exportAfter=await docs('export',{id:document.id});
  assert.deepEqual(exportAfter.rows,exportBefore.rows);assert.deepEqual(exportAfter.columns,exportBefore.columns);assert.equal('weightSummary' in exportAfter,false);assert.equal('weightSummary' in exportAfter.document,false);
  const filteredExport=await docs('export-filtered',{id:document.id,...keepFilters,expectedUpdatedAt:document.updatedAt});
  assert.deepEqual(filteredExport.rows,keep.entries.map(entry=>exportBefore.rows.find(row=>row.entryId===entry.id)));assert.deepEqual(filteredExport.columns,exportBefore.columns);assert.equal('weightSummary' in filteredExport,false);
  assert.deepEqual((await docs('get',{id:document.id})).document.entries.map(entry=>entry.source),sourceBefore,'Summary reads never alter original report evidence');

  await edit(0,{PESOBRUTO:'10.000001',TARA:'0.000001'});
  assert.deepEqual(metrics((await table()).weightSummary),expected(5,2,'20.000001','13',1,2),'Editing destination cells immediately changes the screen totals');
  assert.deepEqual(document.entries.map(entry=>entry.source),sourceBefore);
  await edit(3,{COD_EQUIPAMENTO_TRANSPORTE:'000789'});
  const conflict=(await table()).weightSummary;
  assert.equal(conflict.tripCount,2);assert.equal(conflict.equipmentCount,1);
  assert.deepEqual(metrics(equipment(conflict,'conflict',['000456','000789'])),expected(3,1,'8','2',1,2));
  assert.equal(conflict.equipment.reduce((sum,row)=>sum+row.tripCount,0),2,'A conflicted trip is represented once instead of counted for each equipment code');
  const filteredConflict=(await table({columnFilters:{MARKER:['KEEP']}})).weightSummary;
  assert.ok(equipment(filteredConflict,'conflict',['000456','000789']),'Filtering out the differing row cannot hide a trip-level equipment conflict');
  document=(await docs('save-bulk',{id:document.id,entryIds:document.entries.slice(2).map(entry=>entry.id),fieldKey:'COD_EQUIPAMENTO_TRANSPORTE',value:'',expectedUpdatedAt:document.updatedAt})).document;
  const unassigned=(await table()).weightSummary;assert.equal(unassigned.equipmentCount,1);assert.deepEqual(metrics(equipment(unassigned,'missing',[])),expected(3,1,'8','2',1,2));

  document=(await docs('save-entry',{id:document.id,date:'2026-10-22',values:{COD_ENTRADA:'700',COD_EQUIPAMENTO_TRANSPORTE:'000123',PESOBRUTO:'7',TARA:'2',MARKER:'MANUAL'},reviewed:false,expectedUpdatedAt:document.updatedAt})).document;
  const manual=(await table({columnFilters:{MARKER:['MANUAL']}})).weightSummary;
  assert.deepEqual(metrics(manual),expected(1,0,'7','5',0,0));assert.equal(manual.unlinkedEntryCount,1);assert.equal(manual.partialTripCount,0);assert.deepEqual(manual.groupSizes,[]);
  assert.equal(manual.trips.length,1);assert.equal(manual.trips[0].linked,false);assert.equal(manual.trips[0].groupOrdinal,null);
  assert.deepEqual(metrics((await table()).weightSummary),expected(6,2,'27.000001','18',1,2));
  document=(await docs('change-column-type',{id:document.id,fieldKey:'TARA',type:'text',expectedUpdatedAt:document.updatedAt})).document;
  assert.deepEqual(metrics((await table()).weightSummary),expected(6,2,'27.000001',null,1,6),'Text tare cells cannot participate in net weight calculations');
  document=(await docs('change-column-type',{id:document.id,fieldKey:'PESOBRUTO',type:'text',expectedUpdatedAt:document.updatedAt})).document;
  assert.deepEqual(metrics((await table()).weightSummary),expected(6,2,null,null,6,6),'Numeric-looking text gross weights do not become business numbers implicitly');
  await setActor(ids.otherOwner);await assert.rejects(()=>table(),error=>error.code==='P0002');
  await setActor(null);await assert.rejects(()=>table(),error=>error.code==='28000');
 }finally{await db.close();}
});
