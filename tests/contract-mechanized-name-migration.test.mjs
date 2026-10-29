import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('mechanized name correction updates only the identified owner/type and keeps contract data',async()=>{
 const {db,ids}=await createCaneWeighingDb();
 const target='3c6c1b60-a053-4a33-b8e8-47affdd5577b';
 try{
  await db.exec('RESET ROLE');
  await db.query(`INSERT INTO public.billing_contract_types(id,owner_id,name,stages) VALUES($1,$2,'MACANIZADO','[]')`,[target,ids.owner]);
  const manual=(await db.query(`INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'MANUAL','[]') RETURNING id`,[ids.owner])).rows[0].id;
  const other=(await db.query(`INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'MACANIZADO','[]') RETURNING id`,[ids.otherOwner])).rows[0].id;
  const create=async(owner,company,client,type,title,typeName)=>(await db.query(`INSERT INTO public.billing_contracts(owner_id,company_id,client_id,type_id,title,type_name,stages,status,start_date,contracted_volume,value,notes) VALUES($1,$2,$3,$4,$5,$6,'[]','Ativo','2026-10-01',123.456,789.12,'Preservar condições') RETURNING id`,[owner,company,client,type,title,typeName])).rows[0].id;
  const corrected=await create(ids.owner,ids.company,ids.partner,target,'Contrato MACANIZADO - safra','MACANIZADO');
  const custom=await create(ids.owner,ids.company,ids.partner,target,'Safra Pinheiro','MACANIZADO');
  const differentType=await create(ids.owner,ids.company,ids.partner,manual,'Referência MACANIZADO','MANUAL');
  const differentOwner=await create(ids.otherOwner,ids.otherCompany,ids.otherPartner,other,'Contrato MACANIZADO','MACANIZADO');
  const sql=await readFile(new URL('../supabase/migrations/20261029172530_correct_mechanized_contract_type_name.sql',import.meta.url),'utf8');
  await db.exec(sql);
  const type=(await db.query('SELECT name,name_key FROM public.billing_contract_types WHERE id=$1',[target])).rows[0];
  assert.equal(type.name,'MECANIZADO');assert.equal(type.name_key,'mecanizado');
  const get=async(id)=>(await db.query('SELECT title,type_name,contracted_volume::text,value::text,notes,type_id FROM public.billing_contracts WHERE id=$1',[id])).rows[0];
  assert.deepEqual(await get(corrected),{title:'Contrato MECANIZADO - safra',type_name:'MECANIZADO',contracted_volume:'123.456',value:'789.12',notes:'Preservar condições',type_id:target});
  assert.equal((await get(custom)).title,'Safra Pinheiro');assert.equal((await get(custom)).type_name,'MECANIZADO');
  assert.equal((await get(differentType)).title,'Referência MACANIZADO');
  assert.equal((await get(differentOwner)).type_name,'MACANIZADO');
  assert.equal((await db.query('SELECT name FROM public.billing_contract_types WHERE id=$1',[other])).rows[0].name,'MACANIZADO');
  const before=await get(corrected);await db.exec(sql);assert.deepEqual(await get(corrected),before,'Reapplying the correction is safe');
 }finally{await db.close();}
});
