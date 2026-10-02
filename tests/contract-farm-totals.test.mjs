import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// In-memory contract test of the actual migration. Pricing/auth helpers are
// fixtures: this verifies aggregation and preserved guards, not live RLS/RPC.
const db=new PGlite();
const uuid=value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
const owner=uuid(1),otherOwner=uuid(2),company=uuid(3),otherCompany=uuid(4);
const contract=uuid(5),otherContract=uuid(6),farms=[11,12,13,14].map(uuid);
const migration=await readFile(new URL('../supabase/migrations/20261002211618_contract_load_farm_totals.sql',import.meta.url),'utf8');
const payload={view:'loads',companyId:company,contractId:contract,search:'',from:'2026-09-01',to:'2026-09-02',groupBy:'day'};
const setting=(key,value)=>db.query('select set_config($1,$2,false)',[key,value]);
const list=async overrides=>(await db.query('select billing_private.contract_loads_list($1::jsonb) result',[JSON.stringify({...payload,...overrides})])).rows[0].result;
const denied=async(fn,code)=>assert.rejects(fn,error=>error.code===code);
const cents=value=>{
 const negative=value.startsWith('-'),[whole,part='']=value.replace('-','').split('.');
 return (BigInt(whole)*100n+BigInt(part.padEnd(2,'0')))*(negative?-1n:1n);
};

try{
 await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  CREATE SCHEMA billing_private;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
   SELECT nullif(current_setting('fixture.user',true),'')::uuid
  $$;
  CREATE FUNCTION billing_private.current_owner_id() RETURNS uuid LANGUAGE sql AS $$
   SELECT nullif(current_setting('fixture.owner',true),'')::uuid
  $$;
  CREATE FUNCTION billing_private.authorize_resource(resource text,action text)
  RETURNS void LANGUAGE plpgsql AS $$ BEGIN
   IF resource<>'contracts' OR action<>'list' OR current_setting('fixture.allowed',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Denied' USING ERRCODE='42501';
   END IF;
  END $$;
  CREATE FUNCTION billing_private.decimal_text(value numeric) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT trim_scale(value)::text $$;
  CREATE TABLE public.billing_contracts(id uuid PRIMARY KEY,owner_id uuid,company_id uuid);
  CREATE TABLE public.billing_farms(id uuid PRIMARY KEY,owner_id uuid,name text);
  CREATE TABLE public.billing_farm_plots(id uuid PRIMARY KEY,owner_id uuid,farm_id uuid,name text);
  CREATE TABLE public.billing_contract_loads(
   id uuid PRIMARY KEY,owner_id uuid,contract_id uuid,farm_id uuid,plot_id uuid,
   loaded_at date,volume numeric,atr numeric,document text,notes text,
   created_at timestamptz DEFAULT '2026-09-01T12:00:00Z',
   updated_at timestamptz DEFAULT '2026-09-01T12:00:00Z'
  );
  CREATE TABLE fixture_pricing(load_id uuid PRIMARY KEY,gross_amount numeric,discount_amount numeric,net_amount numeric,atr_quote numeric);
  CREATE FUNCTION billing_private.contract_load_financials(contract public.billing_contracts)
  RETURNS TABLE(load_id uuid,gross_amount numeric,discount_amount numeric,net_amount numeric,atr_quote numeric)
  LANGUAGE sql AS $$
   SELECT p.* FROM public.fixture_pricing p JOIN public.billing_contract_loads l ON l.id=p.load_id
   WHERE l.owner_id=contract.owner_id AND l.contract_id=contract.id
  $$;
  CREATE FUNCTION billing_private.contract_atr_reference(contract public.billing_contracts,loaded date)
  RETURNS TABLE(atr_reference_month date) LANGUAGE sql AS $$ SELECT date_trunc('month',loaded)::date $$;
 `);
 await db.exec(migration);
 await setting('fixture.user',owner);
 await setting('fixture.owner',owner);
 await setting('fixture.allowed','yes');
 await db.query('insert into public.billing_contracts values ($1,$2,$3),($4,$2,$3)',[contract,owner,company,otherContract]);
 for(const [index,id] of farms.entries()){
  await db.query('insert into public.billing_farms values($1,$2,$3)',[id,owner,index<2?'Fazenda homônima':`Fazenda ${index}`]);
 }
 const fixtures=[
  {id:21,farm:farms[0],day:'2026-09-01',volume:'10.125',gross:'33.34',discount:'3.33',net:'30.01',document:'alpha'},
  {id:22,farm:farms[0],day:'2026-09-02',volume:'20.125',gross:'33.33',discount:'3.33',net:'30',document:'beta'},
  {id:23,farm:farms[1],day:'2026-09-02',volume:'30.25',gross:'33.33',discount:'40',net:'-6.67'},
  {id:24,farm:farms[2],day:'2026-09-03',volume:'5',gross:null,discount:'1',net:null},
  {id:25,farm:farms[3],day:'2026-09-04',volume:'7',gross:'20',discount:'2',net:null},
  {id:26,farm:farms[0],day:'2026-09-02',volume:'900',gross:'900',discount:'0',net:'900',contractId:otherContract},
  {id:27,farm:farms[0],day:'2026-09-02',volume:'800',gross:'800',discount:'0',net:'800',ownerId:otherOwner},
 ];
 for(const row of fixtures){
  await db.query(`insert into public.billing_contract_loads(id,owner_id,contract_id,farm_id,loaded_at,volume,atr,document,notes)
   values($1,$2,$3,$4,$5,$6,120,$7,'')`,[uuid(row.id),row.ownerId??owner,row.contractId??contract,row.farm,row.day,row.volume,row.document??'']);
  await db.query('insert into fixture_pricing values($1,$2,$3,$4,1.2)',[uuid(row.id),row.gross,row.discount,row.net]);
 }

 const result=await list();
 assert.equal(result.farms.length,2,'Same-name farms must remain distinct by ID');
 assert.deepEqual(result.farms.map(row=>row.id),farms.slice(0,2),'Stable name/ID ordering');
 assert.deepEqual(result.farms.map(row=>[row.volume,row.grossAmount,row.netAmount,row.loadCount,row.billingPending]),[
  ['30.25','66.67','60.01',2,false],['30.25','33.33','-6.67',1,false],
 ]);
 assert.equal(result.summary.volume,'60.5');
 assert.equal(result.summary.grossAmount,'100');
 assert.equal(result.summary.netAmount,'53.34');
 for(const field of ['grossAmount','netAmount']){
  assert.equal(result.farms.reduce((total,row)=>total+cents(row[field]),0n),cents(result.summary[field]),`${field} must reconcile to preallocated cents`);
 }
 assert.equal(result.groups.flatMap(row=>row.loads).length,3,'Other contract/owner rows must remain excluded');
 assert.ok(result.groups.flatMap(row=>row.loads).every(row=>row.plotId===''),'Plotless loads remain included');
 for(const groupBy of ['day','month','farm','none'])assert.deepEqual((await list({groupBy})).farms,result.farms,'Farm totals must not depend on presentation grouping');

 const oneDay=await list({from:'2026-09-02'});
 assert.equal(oneDay.summary.volume,'50.375');
 assert.equal(oneDay.summary.grossAmount,'66.66');
 assert.equal(oneDay.summary.netAmount,'23.33');
 assert.equal(oneDay.farms[0].loadCount,1,'Both period boundaries are inclusive');
 const search=await list({search:'alpha'});
 assert.equal(search.farms.length,1);
 assert.equal(search.farms[0].grossAmount,'33.34','Search filters apply before farm aggregation');

 const pending=await list({to:'2026-09-04'});
 const missingGross=pending.farms.find(row=>row.id===farms[2]);
 assert.equal(missingGross.grossAmount,'');
 assert.equal(missingGross.netAmount,'');
 assert.equal(missingGross.billingPending,true,'Missing pricing must not become zero');
 const missingNet=pending.farms.find(row=>row.id===farms[3]);
 assert.equal(missingNet.grossAmount,'20');
 assert.equal(missingNet.netAmount,'');
 assert.equal(missingNet.billingPending,true,'Missing net alone must mark the farm pending');
 assert.equal(pending.summary.grossAmount,'');
 assert.equal(pending.summary.netAmount,'');
 await db.query('update public.billing_contract_loads set farm_id=$1 where id=$2',[farms[0],uuid(24)]);
 const mixed=(await list({to:'2026-09-03'})).farms.find(row=>row.id===farms[0]);
 assert.equal(mixed.loadCount,3);
 assert.equal(mixed.volume,'35.25');
 assert.equal(mixed.grossAmount,'','A priced load must not hide a pending load in the same farm');
 assert.equal(mixed.netAmount,'');
 assert.equal(mixed.billingPending,true);
 await db.query('update public.billing_contract_loads set farm_id=$1 where id=$2',[farms[2],uuid(24)]);
 const empty=await list({from:'2027-01-01',to:'2027-01-02'});
 assert.deepEqual(empty.farms,[]);
 assert.equal(empty.summary.volume,'0');

 await denied(()=>list({companyId:otherCompany}),'P0002');
 await setting('fixture.user',otherOwner);
 await setting('fixture.owner',otherOwner);
 await denied(()=>list(),'P0002');
 await setting('fixture.owner',owner);
 await setting('fixture.user','');
 await denied(()=>list(),'28000');
 await setting('fixture.user',owner);
 await setting('fixture.owner','');
 await denied(()=>list(),'28000');
 await setting('fixture.owner',owner);
 await setting('fixture.allowed','no');
 await denied(()=>list(),'42501');
 await setting('fixture.allowed','yes');
 await denied(()=>list({ownerId:otherOwner}),'22023');
 await denied(()=>list({from:'2026-09-03',to:'2026-09-01'}),'22023');
 const privileges=await db.query(`select role,has_function_privilege(role,'billing_private.contract_loads_list(jsonb)','execute') allowed from (values('anon'),('authenticated')) roles(role)`);
 assert.ok(privileges.rows.every(row=>!row.allowed),'Private function must remain unavailable to anon/authenticated directly');
 console.log('contract farm totals: exact cents, pending/negative values, grouping, filters and preserved authorization guards passed');
}finally{
 await db.close();
}
