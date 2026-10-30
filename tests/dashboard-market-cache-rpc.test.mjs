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
 await db.exec(await readFile(new URL('../supabase/migrations/20261030135358_dashboard_market_variation_bases.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261030141139_dashboard_market_indices_gold.sql',import.meta.url),'utf8'));
 const actor=async(role='authenticated',id='11111111-1111-4111-8111-111111111111')=>{await db.exec('RESET ROLE');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,...(id?{sub:id}:{})})]);await db.exec(`SET ROLE ${role}`);};
 const rpc=async(payload={group:'currency'})=>(await db.query("select public.billing_rpc('dashboard-market','get',$1::jsonb) result",[JSON.stringify(payload)])).rows[0].result;
 const worker=async(action,payload)=>(await db.query('select public.refresh_dashboard_market($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
 const due=async()=>{await db.exec('RESET ROLE');await db.exec("update billing_private.market_refresh_state set next_refresh_at='-infinity',lease_until=null,lease_token=null where group_id='currency'");await actor('service_role',null);};
 return {db,actor,rpc,worker,due};
}
const quote=(value='5.12345678901234567890123456789',date='2026-10-29',observedAt='2026-10-29T15:00:00.000Z')=>({id:'usd',value,date,observedAt,changePercent:'-0.123456789',status:'available',source:'AwesomeAPI',sourceUrl:'https://docs.awesomeapi.com.br/api-de-moedas',note:'Câmbio comercial'});
const deny=(job,code)=>assert.rejects(job,error=>error.code===code);

test('indices and gold use private scheduled cache, exact decimals, history and group isolation',async()=>{
 const {db,actor,rpc,worker}=await fixture();
 try{
  const job=(await db.query("SELECT schedule,active,command FROM cron.job WHERE jobname='billing-market-exchange'")).rows[0];
  assert.equal(job.schedule,'* * * * *');assert.equal(job.active,true);assert.match(job.command,/'exchange'/);
  await actor();const initial=await rpc({group:'exchange'});assert.equal(initial.refreshSeconds,60);assert.deepEqual(initial.quotes.map(q=>q.id),['gold','ibovespa','sp500']);
  await deny(()=>worker('claim',{group:'exchange'}),'42501');await deny(()=>rpc({group:'exchange',ownerId:'other'}),'22023');
  await actor('service_role',null);const {token}=await worker('claim',{group:'exchange'});
  await deny(()=>worker('finish',{group:'exchange',token,quotes:[quote()]}),'22023');
  const refs=['ibovespa','sp500','gold'].map(id=>({...quote('123456.1234567890123456789'),id,source:'Yahoo Finance',sourceUrl:'https://finance.yahoo.com/quote/'+id,changePercent:'-0.375'}));
  await worker('finish',{group:'exchange',token,quotes:refs});
  await actor();const feed=await rpc({group:'exchange'});assert.ok(feed.quotes.every(q=>q.value==='123456.1234567890123456789'&&q.changePercent==='-0.375'&&q.changeBasis==='source'));
  assert.equal((await rpc()).quotes.length,2);assert.equal((await rpc({})).quotes.length,14);
  for(const id of ['ibovespa','sp500','gold']){
   const history=(await db.query("SELECT public.billing_rpc('dashboard-market','history',$1::jsonb) result",[JSON.stringify({id})])).rows[0].result;
   assert.equal(history.days.length,1);assert.equal(history.days[0].value,'123456.1234567890123456789');
  }
  await actor('authenticated','22222222-2222-4222-8222-222222222222');assert.deepEqual((await rpc({group:'exchange'})).quotes,feed.quotes);
  await deny(()=>db.query("UPDATE billing_private.market_quotes SET value=1 WHERE id='gold'"),'42501');
  await actor('anon',null);await deny(()=>rpc({group:'exchange'}),'28000');
 }finally{await db.close();}
});
const daily=(value='125',date='2026-10-29',extra={})=>({...quote(value,date),observedAt:undefined,changePercent:undefined,source:'Official daily',...extra});

test('Postgres calculates exact changes against stored publications, retains bases on repeated collections and distinguishes source percentages',async()=>{
 const {db,actor,rpc,worker,due}=await fixture();
 const save=async quote=>{await due();const {token}=await worker('claim',{group:'currency'});await worker('finish',{group:'currency',token,quotes:[quote]});await actor();return (await rpc()).quotes.find(q=>q.id==='usd');};
 try{
  let q=await save(daily('125','2026-10-29',{previousValue:'100',previousDate:'2026-10-28'}));assert.equal(q.changePercent,'25.000000');assert.equal(q.changeBasis,'previous-publication');assert.equal(q.previousValue,'100');
  q=await save(daily());assert.equal(q.changePercent,'25.000000','A repeated price is still compared with the earlier publication, not with itself');
  q=await save(daily('100','2026-10-30'));assert.equal(q.changePercent,'-20.000000');assert.equal(q.previousDate,'2026-10-29');
  q=await save(daily('125','2026-10-30'));assert.equal(Number(q.changePercent),0,'An unchanged price is a real zero');
  q=await save(daily('100','2026-10-30',{source:'Another daily source'}));assert.equal(q.changePercent,undefined,'Different publishers cannot become a comparison baseline');
  q=await save(quote('5.2','2026-10-30','2026-10-30T10:00:00Z'));assert.equal(q.changePercent,'-0.123456789');assert.equal(q.changeBasis,'source');
  await due();const {token}=await worker('claim',{group:'currency'});await worker('finish',{group:'currency',token,quotes:[]});await actor();const stale=(await rpc()).quotes.find(q=>q.id==='usd');assert.equal(stale.status,'stale');assert.equal(stale.changePercent,q.changePercent);
 }finally{await db.close();}
});

test('history keeps seven collection days, exposes the final real publication per day, and denies anonymous/direct access',async()=>{
 const {db,actor,rpc,worker,due}=await fixture();
 try{
  await db.exec(`INSERT INTO billing_private.market_quote_history(id,captured_at,value,publication_date,source,source_url,reference_url)
   SELECT 'usd',now()-make_interval(days=>n),100+n,'2026-10-20'::date,'Official daily','https://example.test','https://example.test' FROM generate_series(0,8)n`);
  await due();const {token}=await worker('claim',{group:'currency'});await worker('finish',{group:'currency',token,quotes:[daily()]});await actor();
  const history=async payload=>(await db.query("SELECT public.billing_rpc('dashboard-market','history',$1::jsonb) result",[JSON.stringify(payload)])).rows[0].result;
  const data=await history({id:'usd'});assert.equal(data.days.length,7);assert.equal(data.days[0].value,'125');assert.equal(data.days[0].date,'2026-10-29');assert.equal(typeof data.days[0].capturedAt,'string');
  await deny(()=>db.query('SELECT * FROM billing_private.market_quote_history'),'42501');await deny(()=>history({id:'usd',ownerId:'other'}),'22023');await deny(()=>history({id:'unknown'}),'22023');
  await actor('anon',null);await deny(()=>history({id:'usd'}),'28000');await actor('authenticated','22222222-2222-4222-8222-222222222222');assert.deepEqual(await history({id:'usd'}),data,'Public reference history is shared, not business data');
  await db.exec('RESET ROLE');assert.equal((await db.query("SELECT count(*)::integer n FROM billing_private.market_quote_history WHERE captured_at<now()-interval '7 days'")).rows[0].n,0);assert.ok((await db.query("SELECT command FROM cron.job WHERE jobname='billing-quote-history-retention'")).rows[0].command.includes('7 days'));
 }finally{await db.close();}
});

test('invalid, zero and non-earlier bases fail atomically before prices or history change',async()=>{
 const {db,actor,worker,due}=await fixture();
 try{
  for(const extra of [{previousValue:'0',previousDate:'2026-10-28'},{previousValue:'100',previousDate:'2026-10-29'},{previousValue:'100'},{previousValue:'-5',previousDate:'2026-10-28'}]){
   await due();const {token}=await worker('claim',{group:'currency'});await deny(()=>worker('finish',{group:'currency',token,quotes:[daily('125','2026-10-29',extra)]}),'22023');
   await db.exec('RESET ROLE');assert.equal((await db.query('SELECT count(*)::integer n FROM billing_private.market_quote_history')).rows[0].n,0);
  }
 }finally{await db.close();}
});

test('private market cache is readable only through authenticated RPC, shared references never accept an owner, and clients cannot collect/write',async()=>{
 const {db,actor,rpc,worker}=await fixture();
 try{
  const jobs=(await db.query('SELECT jobname,active FROM cron.job')).rows;assert.equal(jobs.length,5);assert.ok(jobs.every(job=>job.active));assert.ok(jobs.some(job=>job.jobname==='billing-quote-history-retention'));
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
