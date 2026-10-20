// Exercises the real Storage password guard against permissive, owner-scoped
// fixture policies. No remote Supabase project or commercial records are used.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const {PGlite} = await import(process.env.BILLING_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const owner = 'a0000000-0000-4000-8000-000000000001';
const other = 'b0000000-0000-4000-8000-000000000002';
const guardedBuckets = [
  'billing-company-logos',
  'billing-watermarks',
  'billing-signatures',
  'billing-request-files',
  'billing-material-images',
  'billing-quotation-files',
];
const externalBucket = 'external-public';

await db.exec(`
 CREATE ROLE anon;
 CREATE ROLE authenticated;
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY, encrypted_password text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
 $$;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

 CREATE SCHEMA billing_private;
 GRANT USAGE ON SCHEMA billing_private TO authenticated;
 CREATE TABLE billing_private.password_change_requirements(
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  password_hash_at_issue text NOT NULL,
  completed_at timestamptz
 );

 CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text PRIMARY KEY);
 CREATE TABLE storage.objects(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  UNIQUE(bucket_id, name)
 );
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array($1, '/')
 $$;
 GRANT USAGE ON SCHEMA storage TO authenticated;
 GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

 -- Deliberately allow every operation within the actor's own folder. The
 -- restrictive migration must deny access even when a permissive policy grants it.
 CREATE POLICY fixture_workspace_objects ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id LIKE 'billing-%' AND
   (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id LIKE 'billing-%' AND
   (storage.foldername(name))[1] = auth.uid()::text);
 CREATE POLICY fixture_unrelated_bucket ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'external-public')
  WITH CHECK (bucket_id = 'external-public');
`);

await db.query('INSERT INTO auth.users(id, encrypted_password) VALUES ($1, $2), ($3, $4)',
  [owner, 'temporary-hash', other, 'other-hash']);
await db.query(`INSERT INTO billing_private.password_change_requirements
 (user_id, password_hash_at_issue) VALUES ($1, $2)`, [owner, 'temporary-hash']);
for (const bucket of [...guardedBuckets, externalBucket]) {
  await db.query('INSERT INTO storage.buckets(id) VALUES ($1)', [bucket]);
  await db.query('INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2), ($1, $3)',
    [bucket, `${owner}/original`, `${other}/original`]);
}

await db.exec(readFileSync(new URL('../../docs/mcp-sql-pending/20261006005606_storage_temporary_password_guard.sql', import.meta.url), 'utf8'));

async function actAs(userId) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}
async function asFixtureOwner(operation) {
  await db.exec('RESET ROLE');
  try { await operation(); } finally { await db.exec('SET ROLE authenticated'); }
}
async function visible(bucket, name) {
  const response = await db.query('SELECT id FROM storage.objects WHERE bucket_id = $1 AND name = $2', [bucket, name]);
  return response.rows.length;
}
async function expectInsertDenied(bucket, name) {
  await assert.rejects(
    db.query('INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2)', [bucket, name]),
    error => error.code === '42501',
    `${bucket}: pending account inserted an object`,
  );
}
async function expectMutationHidden(bucket, name) {
  const updated = await db.query(
    'UPDATE storage.objects SET name = $3 WHERE bucket_id = $1 AND name = $2 RETURNING id',
    [bucket, name, `${name}-changed`],
  );
  assert.equal(updated.rows.length, 0, `${bucket}: UPDATE reached a hidden object`);
  const deleted = await db.query(
    'DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2 RETURNING id',
    [bucket, name],
  );
  assert.equal(deleted.rows.length, 0, `${bucket}: DELETE reached a hidden object`);
}

await actAs(owner);
assert.equal((await db.query('SELECT billing_private.temporary_password_ready_for_storage() AS ready')).rows[0].ready, false);
for (const bucket of guardedBuckets) {
  assert.equal(await visible(bucket, `${owner}/original`), 0, `${bucket}: SELECT bypassed the pending-password gate`);
  await expectInsertDenied(bucket, `${owner}/new`);
  await expectMutationHidden(bucket, `${owner}/original`);
}

// The restrictive policy is deliberately limited to the six billing buckets.
assert.equal(await visible(externalBucket, `${owner}/original`), 1);
await db.query('INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2)', [externalBucket, `${owner}/new`]);
assert.equal((await db.query(
  'UPDATE storage.objects SET name = $3 WHERE bucket_id = $1 AND name = $2 RETURNING id',
  [externalBucket, `${owner}/new`, `${owner}/renamed`],
)).rows.length, 1);
assert.equal((await db.query(
  'DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2 RETURNING id',
  [externalBucket, `${owner}/renamed`],
)).rows.length, 1);

// A second account remains active and cannot see or mutate the first account's folder.
await actAs(other);
assert.equal((await db.query('SELECT billing_private.temporary_password_ready_for_storage() AS ready')).rows[0].ready, true);
for (const bucket of guardedBuckets) {
  assert.equal(await visible(bucket, `${other}/original`), 1, `${bucket}: active account lost access`);
  assert.equal(await visible(bucket, `${owner}/original`), 0, `${bucket}: foreign object is visible`);
  await expectInsertDenied(bucket, `${owner}/foreign-insert`);
  await expectMutationHidden(bucket, `${owner}/original`);
}

// Match billing_rpc's existing rule: changing the Auth password hash lifts the
// gate even before a later RPC marks the requirement completed.
await asFixtureOwner(async () => {
  await db.query('UPDATE auth.users SET encrypted_password = $2 WHERE id = $1', [owner, 'new-personal-hash']);
});
await actAs(owner);
assert.equal((await db.query('SELECT billing_private.temporary_password_ready_for_storage() AS ready')).rows[0].ready, true);
for (const bucket of guardedBuckets) {
  assert.equal(await visible(bucket, `${owner}/original`), 1, `${bucket}: access did not recover after password change`);
  assert.equal(await visible(bucket, `${other}/original`), 0, `${bucket}: other account's object leaked`);
  await db.query('INSERT INTO storage.objects(bucket_id, name) VALUES ($1, $2)', [bucket, `${owner}/new`]);
  assert.equal((await db.query(
    'UPDATE storage.objects SET name = $3 WHERE bucket_id = $1 AND name = $2 RETURNING id',
    [bucket, `${owner}/new`, `${owner}/renamed`],
  )).rows.length, 1, `${bucket}: UPDATE did not recover`);
  assert.equal((await db.query(
    'DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2 RETURNING id',
    [bucket, `${owner}/renamed`],
  )).rows.length, 1, `${bucket}: DELETE did not recover`);
}
await asFixtureOwner(async () => {
  const requirement = await db.query(
    'SELECT completed_at FROM billing_private.password_change_requirements WHERE user_id = $1', [owner],
  );
  assert.equal(requirement.rows[0].completed_at, null, 'the RLS helper mutated the password requirement');
});

await db.close();
console.log('Storage temporary-password guard: six buckets, all operations, recovery, isolation, external bucket passed');
