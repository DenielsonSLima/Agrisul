import {readdir,readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

export const caneFixtureIds={
 owner:'10000000-0000-4000-8000-000000000001',
 otherOwner:'10000000-0000-4000-8000-000000000002',
 reader:'10000000-0000-4000-8000-000000000003',
 company:'10000000-0000-4000-8000-000000000011',
 siblingCompany:'10000000-0000-4000-8000-000000000012',
 otherCompany:'10000000-0000-4000-8000-000000000013',
 partner:'10000000-0000-4000-8000-000000000021',
 otherPartner:'10000000-0000-4000-8000-000000000022',
 readerProfile:'10000000-0000-4000-8000-000000000031',
};

// Executes the actual complete migration chain. Auth and Storage infrastructure
// are the only fixtures; application authorization and calculations are real SQL.
export async function createCaneWeighingDb(){
 const db=new PGlite();
 await db.exec(`
  CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text,raw_user_meta_data jsonb DEFAULT '{}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO authenticated,anon;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
  CREATE FUNCTION storage.extension(text) RETURNS text LANGUAGE sql AS $$ SELECT reverse(split_part(reverse($1),'.',1)) $$;
  GRANT USAGE ON SCHEMA storage TO authenticated;
  GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
 `);
 const directory=new URL('../../migrations/',import.meta.url);
 for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()){
  try{await db.exec(await readFile(new URL(name,directory),'utf8'));}
  catch(error){await db.close();throw new Error(`Migration ${name}: ${error.message}`,{cause:error});}
 }
 const ids=caneFixtureIds;
 for(const [id,name] of [[ids.owner,'AGRISUL'],[ids.otherOwner,'Outra conta']]){
  await db.query(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())`,[id,`${id}@example.invalid`]);
  await db.query(`SELECT billing_private.create_workspace_defaults($1)`,[id]);
  await db.query(`INSERT INTO public.billing_memberships(owner_id,user_id,is_owner,status) VALUES($1,$1,true,'active')`,[id]);
  await db.query(`INSERT INTO public.billing_user_settings(user_id,owner_id,name,onboarding_completed_at) VALUES($1,$1,$2,now())`,[id,name]);
 }
 await db.query(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'reader@example.invalid',now())`,[ids.reader]);
 await db.query(`INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES($1,$2,'Leitor pesagem',ARRAY['contracts.read'])`,[ids.readerProfile,ids.owner]);
 await db.query(`INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES($1,$2,$3,false,'active')`,[ids.owner,ids.reader,ids.readerProfile]);
 await db.query(`INSERT INTO public.billing_user_settings(user_id,owner_id,name,onboarding_completed_at) VALUES($1,$2,'Leitor',now())`,[ids.reader,ids.owner]);
 for(const [id,owner,name] of [[ids.company,ids.owner,'AGRISUL'],[ids.siblingCompany,ids.owner,'Filial'],[ids.otherCompany,ids.otherOwner,'Outra empresa']]){
  await db.query(`INSERT INTO public.billing_companies(id,owner_id,legal_name,name) VALUES($1,$2,$3,$3)`,[id,owner,name]);
 }
 for(const [id,owner,name] of [[ids.partner,ids.owner,'TAQUARI'],[ids.otherPartner,ids.otherOwner,'Outro parceiro']]){
  await db.query(`INSERT INTO public.billing_clients(id,owner_id,legal_name,cnpj) VALUES($1,$2,$3,'00000000000000')`,[id,owner,name]);
 }
 const setActor=async(user=ids.owner)=>{
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[user??'']);
  await db.exec('SET ROLE authenticated');
 };
 const rpc=async(action,payload={})=>(await db.query(`SELECT public.billing_rpc('cane-weighings',$1,$2::jsonb) AS result`,[action,JSON.stringify(payload)])).rows[0].result;
 await setActor();
 return {db,ids,setActor,rpc};
}
