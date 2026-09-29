import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const provider=readFileSync(new URL('../shared/supabase/AuthProvider.tsx',import.meta.url),'utf8');
const experience=readFileSync(new URL('../shared/supabase/AuthExperience.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20260929142429_require_temporary_password_change.sql',import.meta.url),'utf8');

test('temporary-password access blocks the workspace behind a dedicated auth experience',()=>{
 assert.match(provider,/WorkspaceAccess=[^;]*'password'/);
 assert.match(provider,/auth\.access==='password'/);
 assert.match(provider,/initialMode="temporary-password"/);
});

test('first access changes the Auth password before completing the database gate',()=>{
 assert.match(experience,/if\(mode==='temporary-password'\)\{\s*const \{error\}=await client\.auth\.updateUser\(\{password\}\);if\(error\)throw error;\s*await rpcRequest\('onboarding','complete-password',\{\}\)/);
 assert.match(experience,/readOnly=\{mode==='invite'\|\|mode==='temporary-password'\}/);
});

test('server gate uses the private Auth password hash and protects every non-onboarding RPC',()=>{
 assert.match(migration,/CREATE TABLE billing_private\.password_change_requirements/);
 assert.match(migration,/auth_user\.encrypted_password/);
 assert.match(migration,/v_current IS DISTINCT FROM v_baseline/);
 assert.match(migration,/IF billing_private\.temporary_password_change_required\(\) THEN\s+RAISE EXCEPTION 'Troque a senha temporária/);
 assert.doesNotMatch(migration,/raw_user_meta_data|user_metadata/);
 assert.match(migration,/REVOKE ALL ON FUNCTION billing_private\.require_temporary_password_change\(uuid\) FROM PUBLIC,anon,authenticated/);
});
