import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(readFileSync(new URL('../migrations/20261014104222_billing_healthcheck.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../migrations/20261019185421_rebuilt_project_healthcheck.sql', import.meta.url), 'utf8'));
  await db.exec('CREATE TABLE public.private_health_test(secret text); REVOKE ALL ON public.private_health_test FROM PUBLIC;');

  const {rows: [definition]} = await db.query(`
    SELECT prosecdef, proconfig,
      EXISTS (SELECT 1 FROM aclexplode(proacl) WHERE grantee = 0) AS public_access
    FROM pg_proc WHERE oid = 'public.billing_healthcheck()'::regprocedure
  `);
  assert.equal(definition.prosecdef, false);
  assert.equal(definition.public_access, false);
  assert.ok(definition.proconfig.some(value => value.startsWith('search_path=')));

  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`SET ROLE ${role}`);
    const {rows: [{result}]} = await db.query('SELECT public.billing_healthcheck() AS result');
    assert.deepEqual(Object.keys(result).sort(), ['checkedAt', 'ok', 'projectRef']);
    assert.equal(result.ok, true);
    assert.equal(result.projectRef, 'ykounjabfsrtkzostbbz');
    assert.ok(Math.abs(Date.now() - Date.parse(result.checkedAt)) < 5000);
    await assert.rejects(db.query('SELECT * FROM public.private_health_test'), /permission denied/);
    await db.exec('RESET ROLE');
  }
  console.log('Health RPC works for public clients without granting access to protected tables.');
} finally {
  await db.close();
}
