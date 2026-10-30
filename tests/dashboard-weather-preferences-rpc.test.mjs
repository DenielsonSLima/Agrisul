import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {installSchedulingFixture} from '../supabase/tests/helpers/scheduling-fixture.mjs';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA billing_private;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${a}'),('${b}');GRANT USAGE ON SCHEMA auth,billing_private TO anon,authenticated,service_role;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT (auth.jwt()->>'sub')::uuid$$;
  CREATE FUNCTION billing_private.ensure_actor_workspace() RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;
  CREATE FUNCTION public.billing_rpc(p_resource text,p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'login' USING ERRCODE='28000';END IF;PERFORM billing_private.ensure_actor_workspace();RETURN '{}'::jsonb;END$$;
  CREATE PUBLICATION supabase_realtime;`);
 await installSchedulingFixture(db);
 for(const file of ['20261030130255_dashboard_weather_cache.sql','20261030132411_dashboard_weather_preferences_scheduler.sql','20261030180837_dashboard_weather_cached_read.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 const actor=async(role='authenticated',sub=a)=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,...(sub?{sub}:{})})]);await db.exec(`SET ROLE ${role}`);};
 const rpc=async(action,payload={})=>(await db.query("SELECT public.billing_rpc('weather-preferences',$1,$2::jsonb) result",[action,JSON.stringify(payload)])).rows[0].result;
 const worker=async(action,payload={})=>(await db.query('SELECT public.dashboard_weather_cache($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
 return {db,actor,rpc,worker};
}
const deny=(job,code)=>assert.rejects(job,error=>error.code===code);

test('dashboard reads stored forecasts without external services and only for its own selected cities',async()=>{
 const {db,actor,rpc,worker}=await fixture();
 const read=async(payload={cityIds:['2803302']},action='get')=>(await db.query("SELECT public.billing_rpc('dashboard-weather',$1,$2::jsonb) result",[action,JSON.stringify(payload)])).rows[0].result;
 try{
  await actor();await rpc('initialize',{cityIds:['2803401','2803302']});
  const empty=await read();assert.equal(empty.cities[0].payload,null);assert.equal(empty.cities[0].city.name,'Japaratuba');
  await actor('service_role',null);const payload={'2803302':{'30/10/2026':{manha:{resumo:'Muitas nuvens',temp_min:22}}}};
  await worker('save',{cityId:'2803302',payload,fetchedAt:new Date().toISOString()});
  await actor();const cached=await read({cityIds:['2803302','2803401']});assert.deepEqual(cached.cities.map(row=>row.city.id),['2803401','2803302']);assert.deepEqual(cached.cities[1].payload,payload);assert.ok(cached.cities[1].fetchedAt);assert.ok(cached.checkedAt);
  for(const invalid of [{cityIds:['2803302'],ownerId:b},{cityIds:['2803302','2803302']},{cityIds:['bad']},{cityIds:[null]},{cityIds:'2803302'},{}])await deny(()=>read(invalid),'22023');
  await deny(()=>read({cityIds:['2803302']},'save'),'22023');await deny(()=>read({cityIds:['2704302']}),'42501');
  await deny(()=>db.query('SELECT * FROM billing_private.weather_forecasts'),'42501');
  await actor('authenticated',b);await rpc('initialize',{cityIds:[]});await deny(()=>read(),'42501');assert.deepEqual((await read({cityIds:[]})).cities,[]);
  await actor('anon',null);await deny(()=>read(),'28000');
 }finally{await db.close();}
});
test('weather selections persist per account, retain explicit empty lists and deny cross-owner payloads/direct writes',async()=>{
 const {db,actor,rpc,worker}=await fixture();
 try{
  await actor();assert.equal((await rpc('get')).configured,false);
  const first=await rpc('initialize',{cityIds:['2803401','2803302']});assert.deepEqual(first.cities.map(x=>[x.name,x.state]),[['Japoatã','SE'],['Japaratuba','SE']]);
  assert.deepEqual(await rpc('initialize',{cityIds:[]}),first,'Another device cannot overwrite initial preferences');
  await deny(()=>rpc('add',{cityId:'2704302',ownerId:b}),'22023');await deny(()=>db.query('DELETE FROM public.billing_weather_cities'),'42501');
  await deny(()=>db.query(`INSERT INTO public.billing_weather_settings(owner_id) VALUES('${b}')`),'42501');await deny(()=>worker('due'),'42501');
  await actor('authenticated',b);assert.equal((await rpc('get')).configured,false);await rpc('initialize',{cityIds:[]});assert.equal((await rpc('get')).cities.length,0);
  assert.equal((await db.query('SELECT count(*)::integer n FROM public.billing_weather_cities')).rows[0].n,0,'RLS hides the first account');
  await rpc('add',{cityId:'2704302'});await actor();assert.deepEqual((await rpc('get')).cities.map(x=>x.id),['2803401','2803302']);
  const otherConnection=await rpc('get');assert.equal(otherConnection.configured,true);await rpc('remove',{cityId:'2803401'});assert.deepEqual((await rpc('get')).cities.map(x=>x.id),['2803302']);
  await rpc('remove',{cityId:'2803302'});assert.equal((await rpc('get')).configured,true);assert.deepEqual((await rpc('get')).cities,[]);
  assert.equal((await rpc('reset')).cities.length,5);await actor('anon',null);await deny(()=>rpc('get'),'28000');
 }finally{await db.close();}
});
test('server controls uniqueness, maximum city count, canonical names/UF and default reset',async()=>{
 const {db,actor,rpc,worker}=await fixture();
 try{
  await actor('service_role',null);const cities=Array.from({length:21},(_,i)=>({id:String(7100000+i),name:'Cidade '+i,state:'SP'}));
  await worker('register',{cities:cities.slice(0,20)});await worker('register',{cities:cities.slice(20)});await actor();
  await deny(()=>rpc('initialize',{cityIds:cities.map(x=>x.id)}),'22023');await deny(()=>rpc('initialize',{cityIds:['2803302','2803302']}),'22023');await deny(()=>rpc('initialize',{cityIds:['9999999']}),'22023');
  await rpc('initialize',{cityIds:[]});for(const city of cities.slice(0,20))await rpc('add',{cityId:city.id});
  const full=await rpc('get');assert.equal(full.cities.length,20);assert.equal(full.cities[0].state,'SP');assert.deepEqual(await rpc('add',{cityId:cities[0].id}),full);
  await deny(()=>rpc('add',{cityId:cities[20].id}),'22023');await rpc('remove',{cityId:cities[0].id});assert.equal((await rpc('add',{cityId:cities[20].id})).cities.length,20);assert.equal((await rpc('reset')).cities[0].name,'Japaratuba');
 }finally{await db.close();}
});
test('automatic collection deduplicates cities, fences workers, logs attempts and preserves forecasts on failure',async()=>{
 const {db,actor,rpc,worker}=await fixture();
 try{
  await actor();await rpc('initialize',{cityIds:['2803302']});await actor('authenticated',b);await rpc('initialize',{cityIds:['2803302']});
  await actor('service_role',null);assert.equal((await worker('due')).length,1);assert.equal((await worker('claim',{cityId:'2803401'})).token,null,'Unselected cities are not polled');
  const lease=await worker('claim',{cityId:'2803302'});assert.ok(lease.token);assert.equal((await worker('claim',{cityId:'2803302'})).token,null);
  await deny(()=>worker('finish',{cityId:'2803302',token:b,success:true}),'22023');
  const payload={'2803302':{'30/10/2026':{manha:{resumo:'Muitas nuvens'}}}};
  await worker('save',{cityId:'2803302',payload,fetchedAt:new Date().toISOString()});await worker('finish',{cityId:'2803302',token:lease.token,success:true});assert.deepEqual(await worker('due'),[]);
  await db.exec('RESET ROLE');assert.equal((await db.query("SELECT count(*)::integer n FROM billing_private.weather_refresh_log WHERE status='success'")).rows[0].n,1);
  await db.exec("UPDATE billing_private.weather_cities SET next_refresh_at='-infinity' WHERE city_id='2803302';INSERT INTO vault.decrypted_secrets VALUES('dashboard_weather_refresh_token','scoped-fixture-token')");
  assert.ok((await db.query('SELECT billing_private.enqueue_weather_refresh() id')).rows[0].id);assert.equal((await db.query("SELECT count(*)::integer n FROM cron.job WHERE jobname='billing-weather-refresh' AND schedule='*/5 * * * *' AND active")).rows[0].n,1);
  await actor('service_role',null);const next=await worker('claim',{cityId:'2803302'});await worker('finish',{cityId:'2803302',token:next.token,success:false,error:'offline'});
  assert.deepEqual((await worker('get',{cityId:'2803302'})).payload,payload);assert.deepEqual(await worker('due'),[]);
  await db.exec('RESET ROLE');assert.equal((await db.query("SELECT count(*)::integer n FROM billing_private.weather_refresh_log WHERE status='error'")).rows[0].n,1);
 }finally{await db.close();}
});
