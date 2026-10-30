import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('weather cache is private, worker-only and rejects invalid payloads and late overwrites',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA billing_private;
   GRANT USAGE ON SCHEMA auth,billing_private TO anon,authenticated,service_role;
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261030130255_dashboard_weather_cache.sql',import.meta.url),'utf8'));
  const actor=async(role,sub)=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub})]);await db.exec(`SET ROLE ${role}`);};
  const call=async(action,payload)=>(await db.query('SELECT public.dashboard_weather_cache($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
  const denied=job=>assert.rejects(job,error=>error.code==='42501');
  for(const [role,sub] of [['anon',null],['authenticated','11111111-1111-4111-8111-111111111111'],['authenticated','22222222-2222-4222-8222-222222222222']]){
   await actor(role,sub);await denied(()=>call('get',{cityId:'2803302'}));await denied(()=>db.query('SELECT * FROM billing_private.weather_forecasts'));await denied(()=>db.query("INSERT INTO billing_private.weather_forecasts(city_id,payload,fetched_at) VALUES('2803302','{}',now())"));
  }
  await actor('service_role');await denied(()=>db.query('SELECT * FROM billing_private.weather_forecasts'));
  const payload={'2803302':{'30/10/2026':{manha:{resumo:'Muitas nuvens',temp_min:22,temp_max:33}}}},fetchedAt=new Date().toISOString();
  assert.equal(await call('get',{cityId:'2803302'}),null);assert.equal((await call('save',{cityId:'2803302',payload,fetchedAt})).saved,true);
  assert.deepEqual((await call('get',{cityId:'2803302'})).payload,payload);
  assert.equal((await call('save',{cityId:'2803302',payload:{'2803302':{}},fetchedAt:new Date(Date.now()-60000).toISOString()})).saved,false);
  assert.deepEqual((await call('get',{cityId:'2803302'})).payload,payload);
  for(const data of [{cityId:'../../bad',payload,fetchedAt},{cityId:'2803302',payload:{},fetchedAt},{cityId:'2803302',payload,fetchedAt,ownerId:'forged'},{cityId:'2803302',payload,fetchedAt:new Date(Date.now()+3600000).toISOString()}])await assert.rejects(()=>call('save',data),error=>error.code==='22023');
 }finally{await db.close();}
});
