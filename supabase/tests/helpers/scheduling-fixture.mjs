// PGlite has no background workers or network extensions. Keep the real
// application SQL while modelling only Supabase's scheduling infrastructure.
export async function installSchedulingFixture(db){
 await db.exec(`
  CREATE SCHEMA cron;CREATE SCHEMA net;CREATE SCHEMA vault;
  CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
  CREATE FUNCTION cron.schedule(p_name text,p_schedule text,p_command text) RETURNS bigint LANGUAGE sql AS $$
   INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command)
   ON CONFLICT(jobname) DO UPDATE SET schedule=excluded.schedule,command=excluded.command RETURNING jobid $$;
  CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY,decrypted_secret text);
  CREATE TABLE net.fixture_requests(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,url text,body jsonb,headers jsonb);
  CREATE FUNCTION net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$
   INSERT INTO net.fixture_requests(url,body,headers) VALUES($1,$2,$3) RETURNING id $$;
 `);
}
export const withoutSchedulingExtensions=sql=>sql
 .replace('CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;','')
 .replace('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;','');
