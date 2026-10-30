import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {installSchedulingFixture,withoutSchedulingExtensions} from '../supabase/tests/helpers/scheduling-fixture.mjs';

async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
  CREATE SCHEMA auth;CREATE SCHEMA billing_private;
  GRANT USAGE ON SCHEMA auth,billing_private TO anon,authenticated,service_role;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT (auth.jwt()->>'sub')::uuid$$;
  CREATE FUNCTION billing_private.ensure_actor_workspace() RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;
  CREATE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$BEGIN
   IF auth.uid() IS NULL THEN RAISE EXCEPTION 'login' USING ERRCODE='28000'; END IF;
   PERFORM billing_private.ensure_actor_workspace();
   RETURN '{}'::jsonb;
  END$$;
  GRANT EXECUTE ON FUNCTION public.billing_rpc(text,text,jsonb) TO authenticated,anon;`);
 const migration=await readFile(new URL('../supabase/migrations/20261030103125_dashboard_market_cache.sql',import.meta.url),'utf8');
 await installSchedulingFixture(db);
 await db.exec(withoutSchedulingExtensions(migration));
 await db.exec(await readFile(new URL('../supabase/migrations/20261030104655_dashboard_market_refresh_cadence.sql',import.meta.url),'utf8'));
 const actor=async(role='authenticated',id='11111111-1111-4111-8111-111111111111')=>{await db.exec('RESET ROLE');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,...(id?{sub:id}:{})})]);await db.exec(`SET ROLE ${role}`);};
 const rpc=async(payload={group:'currency'})=>(await db.query("select public.billing_rpc('dashboard-market','get',$1::jsonb) result",[JSON.stringify(payload)])).rows[0].result;
 const worker=async(action,payload)=>(await db.query('select public.refresh_dashboard_market($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
 const due=async()=>{await db.exec('RESET ROLE');await db.exec("update billing_private.market_refresh_state set next_refresh_at='-infinity',lease_until=null,lease_token=null where group_id='currency'");await actor('service_role',null);};
 return {db,actor,rpc,worker,due};
}
const quote=(value='5.12345678901234567890123456789',date='2026-10-29',observedAt='2026-10-29T15:00:00.000Z')=>({id:'usd',value,date,observedAt,changePercent:'-0.123456789',status:'available',source:'AwesomeAPI',sourceUrl:'https://docs.awesomeapi.com.br/api-de-moedas',note:'Câmbio comercial'});
const deny=(job,code)=>assert.rejects(job,error=>error.code===code);

test('private market cache is readable only through authenticated RPC, shared references never accept an owner, and clients cannot collect/write',async()=>{
 const {db,actor,rpc,worker}=await fixture();
 try{
  const jobs=(await db.query('SELECT jobname,active FROM cron.job')).rows;assert.equal(jobs.length,3);assert.ok(jobs.every(job=>job.active));
  await actor();const first=await rpc();assert.equal(first.quotes.length,2);assert.equal(first.refreshSeconds,60);assert.ok(first.quotes.every(q=>q.value===null&&q.status==='unavailable'));
  await deny(()=>db.query('select * from billing_private.market_quotes'),'42501');
  await deny(()=>db.query("update billing_private.market_quotes set value=99 where id='usd'"),'42501');
  await deny(()=>worker('claim',{group:'currency'}),'42501');
  await deny(()=>rpc({group:'currency',ownerId:'another'}),'22023');
  for(const group of ['unknown','__proto__',null,[]])await deny(()=>rpc({group}),'22023');
  await actor('authenticated','22222222-2222-4222-8222-222222222222');assert.deepEqual((await rpc()).quotes,first.quotes);
  await actor('anon',null);await deny(()=>rpc(),'28000');
 }finally{await db.close();}
});

test('worker preserves exact numeric strings, missing quotes and regressed publications; recovery makes valid data available again',async()=>{
 const {db,actor,rpc,worker,due}=await fixture();
 try{
  await actor('service_role',null);const lease=await worker('claim',{group:'currency'});assert.ok(lease.token);assert.equal((await worker('claim',{group:'currency'})).token,null);
  await worker('finish',{group:'currency',token:lease.token,quotes:[quote()]});
  await actor();const fresh=(await rpc()).quotes.find(q=>q.id==='usd');assert.equal(fresh.value,quote().value);assert.equal(fresh.changePercent,'-0.123456789');assert.equal(fresh.observedAt,quote().observedAt);assert.equal(fresh.status,'available');
  await due();let token=(await worker('claim',{group:'currency'})).token;
  await worker('finish',{group:'currency',token,quotes:[quote('4','2026-10-28','2026-10-28T15:00:00Z')]});await actor();
  const stale=(await rpc()).quotes.find(q=>q.id==='usd');assert.equal(stale.value,fresh.value);assert.equal(stale.date,fresh.date);assert.equal(stale.observedAt,fresh.observedAt);assert.equal(stale.status,'stale');
  await due();token=(await worker('claim',{group:'currency'})).token;await worker('finish',{group:'currency',token,quotes:[]});await actor();assert.equal((await rpc()).quotes.find(q=>q.id==='usd').value,fresh.value);
  await due();token=(await worker('claim',{group:'currency'})).token;await worker('finish',{group:'currency',token,quotes:[quote('5.2','2026-10-29','2026-10-29T16:00:00.000Z')]});await actor();const recovered=(await rpc()).quotes.find(q=>q.id==='usd');assert.equal(recovered.value,'5.2');assert.equal(recovered.status,'available');
 }finally{await db.close();}
});

test('fenced leases reject late collectors, wrong groups and invalid values atomically, and missed cron runs mark prices stale',async()=>{
 const {db,actor,rpc,worker,due}=await fixture();
 try{
  await due();const old=(await worker('claim',{group:'currency'})).token;await due();const token=(await worker('claim',{group:'currency'})).token;
  await deny(()=>worker('finish',{group:'currency',token:old,quotes:[quote()]}),'22023');
  await deny(()=>worker('finish',{group:'currency',token,quotes:[quote(),quote()]}),'22023');
  await deny(()=>worker('finish',{group:'currency',token,quotes:[{...quote(),id:'soy'}]}),'22023');
  await deny(()=>worker('finish',{group:'currency',token,quotes:[quote('NaN')]}),'22023');
  await deny(()=>worker('finish',{group:'currency',token,quotes:[quote('0')]}),'23514');
  await worker('finish',{group:'currency',token,quotes:[quote()]});
  await db.exec('RESET ROLE');
  const next=(await db.query("select next_refresh_at,extract(second from next_refresh_at) as second_part from billing_private.market_refresh_state where group_id='currency'")).rows[0];assert.equal(Number(next.second_part),0,'The next collection is aligned to Cron, not the finish second');
  await db.exec("update billing_private.market_quotes set checked_at=now()-interval '10 minutes' where id='usd'");await actor();
  assert.equal((await rpc()).quotes.find(q=>q.id==='usd').status,'stale');
 }finally{await db.close();}
});
