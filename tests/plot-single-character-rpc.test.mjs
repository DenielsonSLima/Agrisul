import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('plot RPC accepts a single digit or letter while preserving farm capacity, uniqueness and ownership',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const farm=async(name)=>(await rpc('farms','save',{name,city:'Capela',state:'SE',areaHa:'10'})).farm;
 const save=(farmId,name,areaHa='1',id)=>rpc('plots','save',{farmId,name,areaHa,...(id?{id}:{})});
 try{
  const a=await farm('Fazenda primeira'),b=await farm('Fazenda segunda');
  let summary=(await save(a.id,' 3 ')).data;
  const digit=summary.plots.find(plot=>plot.name==='3');
  assert.ok(digit,'A single digit is accepted and whitespace is trimmed');
  summary=(await save(a.id,'A')).data;
  assert.equal(summary.plots.find(plot=>plot.name==='A').farmId,a.id);
  const existing=(await save(a.id,'03')).data.plots.find(plot=>plot.name==='03');
  assert.ok(existing,'Existing zero-prefixed names remain valid');
  assert.ok((await save(a.id,'3','2',digit.id)).data.plots.some(plot=>plot.id===existing.id&&plot.name==='03'),'Editing 3 leaves 03 unchanged');
  await assert.rejects(()=>save(a.id,'3'),error=>error.code==='23505');
  assert.ok((await save(b.id,'3')).data.plots.some(plot=>plot.name==='3'),'Same identifier is allowed in a different farm');
  for(const name of ['', '   ', 'X'.repeat(151)])await assert.rejects(()=>save(a.id,name),error=>error.code==='22023');
  await assert.rejects(()=>save(a.id,'B','10'),error=>error.code==='23514');
  await assert.rejects(()=>save(b.id,'3','1',digit.id),error=>error.code==='P0002');
  await setActor(ids.otherOwner);
  await assert.rejects(()=>save(a.id,'4'),error=>error.code==='P0002');
  await assert.rejects(()=>rpc('plots','list',{farmId:a.id}),error=>error.code==='P0002');
  assert.equal((await db.query('SELECT count(*)::int n FROM public.billing_farm_plots WHERE farm_id=$1',[a.id])).rows[0].n,0);
  await setActor(ids.reader);
  await assert.rejects(()=>save(a.id,'4'),error=>error.code==='42501');
  await setActor(null);
  await assert.rejects(()=>save(a.id,'4'),error=>error.code==='28000');
 }finally{await db.close();}
});
