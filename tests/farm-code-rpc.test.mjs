import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('optional farm code persists exactly through RPC with capacity and account isolation',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const input={name:'Fazenda código',areaHa:'10',city:'Cuiabá',state:'MT'};
 try{
  let farm=(await rpc('farms','save',{...input,code:'  005032-A  ',owner_id:ids.otherOwner})).farm;
  assert.equal(farm.code,'005032-A');
  assert.equal((await rpc('farms','list')).farms.find(item=>item.id===farm.id).code,'005032-A');
  assert.equal((await rpc('farms','get',{id:farm.id})).farm.code,'005032-A');
  await rpc('plots','save',{farmId:farm.id,name:'Talhão 01',areaHa:'6'});
  assert.equal((await rpc('plots','list',{farmId:farm.id})).data.farm.code,'005032-A');
  // An older browser omitting the optional field must preserve its saved value.
  farm=(await rpc('farms','save',{...input,id:farm.id})).farm;
  assert.equal(farm.code,'005032-A');
  assert.equal((await rpc('farms','save',{...input,id:farm.id,code:'0007'})).farm.code,'0007');
  await assert.rejects(()=>rpc('farms','save',{...input,id:farm.id,code:'x'.repeat(51)}),/50 caracteres/);
  for(const code of [123,null,{},[]])await assert.rejects(()=>rpc('farms','save',{...input,id:farm.id,code}),/como texto/);
  await assert.rejects(()=>rpc('farms','save',{...input,id:farm.id,areaHa:'5',code:'new'}),/soma dos talhões/);
  assert.equal((await rpc('farms','get',{id:farm.id})).farm.code,'0007');
  assert.equal((await rpc('farms','save',{...input,id:farm.id,code:''})).farm.code,'');
  assert.equal((await rpc('farms','save',{...input,name:'Fazenda sem código'})).farm.code,'');
  await assert.rejects(()=>db.query('update public.billing_farms set code=$1 where id=$2',['forbidden',farm.id]),/permission denied/);
  await setActor(ids.otherOwner);
  assert.equal((await rpc('farms','list')).farms.length,0);
  await assert.rejects(()=>rpc('farms','get',{id:farm.id}));
  await assert.rejects(()=>rpc('farms','save',{...input,id:farm.id,code:'other'}));
  assert.equal((await db.query('select code from public.billing_farms where id=$1',[farm.id])).rows.length,0);
  await setActor(ids.reader);
  await assert.rejects(()=>rpc('farms','save',{...input,code:'reader'}));
  await setActor(null);
  await assert.rejects(()=>rpc('farms','list'),/login/i);
 }finally{await db.close();}
});
