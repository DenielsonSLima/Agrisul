import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';
const migration=await readFile(new URL('../supabase/migrations/20261102161426_overtime_dominant_reference_month.sql',import.meta.url),'utf8');

test('period month counts inclusive days, handles leap years and ties, and recalculates RPC saves',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(action,payload)=>(await db.query("SELECT public.billing_rpc('overtime',$1,$2::jsonb) result",[action,JSON.stringify(payload)])).rows[0].result;
 try{
  await db.exec('RESET ROLE');
  for(const [from,to,month] of [
   ['2026-10-26','2026-11-25','2026-11-01'],
   ['2026-10-01','2026-11-05','2026-10-01'],
   ['2026-12-26','2027-01-25','2027-01-01'],
   ['2024-02-15','2024-03-14','2024-02-01'],
   ['2026-01-17','2026-02-15','2026-02-01'],
   ['2026-01-31','2026-04-01','2026-03-01'],
   ['2026-11-02','2026-11-02','2026-11-01'],
  ]){
   const result=(await db.query('SELECT billing_private.overtime_reference_month($1::date,$2::date)::text AS reference',[from,to])).rows[0];
   assert.equal(result.reference,month,`${from} a ${to}`);
  }
  await assert.rejects(db.query("SELECT billing_private.overtime_reference_month('2026-11-02','2026-11-01')"),error=>error.code==='22023');
  await setActor();
  await assert.rejects(db.query("SELECT billing_private.overtime_reference_month('2026-10-26','2026-11-25')"),error=>error.code==='42501','Private helper does not become a public endpoint');
  const scope={companyId:ids.company};
  const report=(await rpc('create',{...scope,dateFrom:'2026-10-26',dateTo:'2026-11-25',notes:''})).report;
  assert.equal(report.referenceMonth,'2026-11');
  const changed=(await rpc('save',{...scope,id:report.id,expectedUpdatedAt:report.updatedAt,dateFrom:'2026-11-26',dateTo:'2026-12-25',referenceMonth:'2026-01',sector:'',notes:'',rows:[]})).report;
  assert.equal(changed.referenceMonth,'2026-12','Server derives reference month even if an older client submits another month');
  assert.equal((await rpc('get',{...scope,id:report.id})).report.referenceMonth,'2026-12');
  assert.equal((await rpc('list',{...scope,search:'12/2026'})).reports[0].id,report.id,'Month search agrees with the persisted and exported month');
  await setActor(ids.otherOwner);
  await assert.rejects(rpc('get',{...scope,id:report.id}),error=>error.code==='P0002');
  await db.exec('RESET ROLE');
  await db.query("UPDATE public.billing_access_profiles SET permissions=ARRAY['requests.read'] WHERE id=$1",[ids.readerProfile]);
  await setActor(ids.reader);
  assert.equal((await rpc('get',{...scope,id:report.id})).report.referenceMonth,'2026-12');
  await assert.rejects(rpc('create',{...scope,dateFrom:'2026-10-26',dateTo:'2026-11-25',notes:''}),error=>error.code==='42501');
 }finally{await db.close();}
});

test('migration corrects existing open and finalized reports without changing unrelated values',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA billing_private;
   CREATE TABLE public.billing_overtime_reports(id int,date_from date,date_to date,reference_month date,status text,notes text);
   INSERT INTO public.billing_overtime_reports VALUES
    (1,'2026-10-26','2026-11-25','2026-10-01','open','Preservar observação'),
    (2,'2026-12-26','2027-01-25','2026-12-01','finished','Finalizado'),
    (3,'2026-11-01','2026-11-30','2026-11-01','open','Mesmo mês');`);
  await db.exec(migration);
  const rows=(await db.query('SELECT id,reference_month::text AS reference,status,notes FROM public.billing_overtime_reports ORDER BY id')).rows;
  assert.deepEqual(rows,[
   {id:1,reference:'2026-11-01',status:'open',notes:'Preservar observação'},
   {id:2,reference:'2027-01-01',status:'finished',notes:'Finalizado'},
   {id:3,reference:'2026-11-01',status:'open',notes:'Mesmo mês'},
  ]);
 }finally{await db.close();}
});
