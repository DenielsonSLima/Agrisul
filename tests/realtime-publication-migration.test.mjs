import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {realtimeResources} from '../shared/query/realtimeResources.ts';

const migrationUrl = new URL(
  '../supabase/migrations/20260924103724_ensure_realtime_publication_for_fleet_and_material_variants.sql',
  import.meta.url,
);

test('migration publishes fleet and material variants idempotently', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  for (const table of ['billing_fleet_vehicles', 'billing_material_variants']) {
    assert.match(sql, new RegExp(`'${table}'`), `${table} must be listed by the migration`);
  }

  assert.match(sql, /IF NOT EXISTS\s*\([\s\S]*?FROM pg_catalog\.pg_publication\b[\s\S]*?RAISE EXCEPTION/);
  assert.match(sql, /FROM pg_catalog\.pg_class AS relation[\s\S]*?relation\.relkind IN \('r', 'p'\)[\s\S]*?RAISE EXCEPTION/);
  assert.match(sql, /FROM pg_catalog\.pg_publication_tables[\s\S]*?tablename = v_table[\s\S]*?ALTER PUBLICATION supabase_realtime ADD TABLE public\.%I/);
});

test('frontend invalidates fleet and material projections for those tables', () => {
  assert.deepEqual(realtimeResources.billing_fleet_vehicles, ['fleet']);
  assert.ok(realtimeResources.billing_material_variants.includes('materials'));
  assert.ok(realtimeResources.billing_material_variants.includes('quotations'));
});
