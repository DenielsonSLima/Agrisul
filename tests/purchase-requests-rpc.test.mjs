import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('Purchase requests: quantities, fleet links, filters, retries, revisions, permissions and account isolation',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const purchases=(action,payload)=>rpc('purchase-requests',action,payload);
 const denied=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 try {
  const category=(await rpc('material-categories','save',{name:'Filtros'})).category;
  const material=(await rpc('materials','save',{name:'Filtro de ar',internalCode:'AP4440',unit:'PC',application:'Trator',categoryId:category.id})).material;
  const vehicle=(await rpc('fleet','save',{internalCode:'139',brand:'Valtra',model:'BH 145',description:'Ano 2007'})).vehicle;
  const input={id:randomUUID(),requestedOn:'2026-09-14',requestNumber:'375',itemType:'material',materialId:material.id,categoryId:null,description:'Filtro de ar primário',reference:'AP4440',quantity:'2,125678',unit:'PC',application:'Tratores BH',urgent:true,status:'open',notes:'Fonte: planilha',vehicleIds:[vehicle.id,vehicle.id],sourceKey:'photo:1'};
  const saved=(await purchases('save',input)).request;
  assert.equal(saved.quantity,'2.125678');assert.equal(saved.categoryId,category.id);assert.equal(saved.vehicles.length,1);
  assert.equal((await purchases('save',{...input,id:randomUUID()})).request.id,saved.id,'Source retry never duplicates a line');
  assert.equal((await purchases('list',{search:'139'})).total,1);
  assert.equal((await purchases('list',{search:'AP4440',categoryId:category.id,dateFrom:'2026-09-14',dateTo:'2026-09-14'})).total,1);
  assert.equal((await purchases('list',{dateFrom:'2026-09-15'})).total,0);
  await denied(()=>purchases('save',{...input,expectedUpdatedAt:'2000-01-01'}),'40001');
  const updated=(await purchases('save',{...input,status:'ordered',expectedUpdatedAt:saved.updatedAt})).request;
  assert.equal((await purchases('list',{status:'open'})).total,0);assert.equal((await purchases('list',{status:'ordered'})).total,1);
  for(const change of [{id:randomUUID(),quantity:'0'},{id:randomUUID(),quantity:'1.1234567'},{id:randomUUID(),requestedOn:'2026-02-30'},{id:randomUUID(),ownerId:ids.otherOwner},{id:randomUUID(),itemType:'service'}]) {
   await denied(()=>purchases('save',{...input,sourceKey:'',...change}),'22023');
  }
  for(const filters of [{dateFrom:'2026-10-01',dateTo:'2026-09-01'},{pageSize:101},{status:'paid'},{ownerId:ids.owner}])await denied(()=>purchases('list',filters),'22023');
  await denied(()=>db.query('delete from public.billing_purchase_requests where id=$1',[saved.id]),'42501');
  await setActor(ids.otherOwner);
  assert.equal((await purchases('list')).total,0);
  assert.equal((await db.query('select * from public.billing_purchase_requests')).rows.length,0);
  await denied(()=>purchases('save',{...input,id:randomUUID(),sourceKey:''}),'22023');
  await denied(()=>purchases('save',{...input,expectedUpdatedAt:updated.updatedAt}),'P0002');
  await setActor(ids.reader);
  await denied(()=>purchases('list'),'42501');
  await db.exec('RESET ROLE');
  await db.query("update public.billing_access_profiles set permissions=ARRAY['registrations.read'] where id=$1",[ids.readerProfile]);
  await setActor(ids.reader);
  assert.equal((await purchases('list')).total,1);
  await denied(()=>purchases('save',{...input,expectedUpdatedAt:updated.updatedAt}),'42501');
  await setActor(null);await denied(()=>purchases('list'),'28000');
  await setActor();
  await denied(()=>purchases('delete',{id:saved.id,expectedUpdatedAt:saved.updatedAt}),'40001');
  await purchases('delete',{id:saved.id,expectedUpdatedAt:updated.updatedAt});
  assert.equal((await purchases('list')).total,0);
  assert.equal((await db.query('select * from public.billing_purchase_request_vehicles')).rows.length,0);
 } finally {await db.close();}
});
