import {callMcp, PROJECT_REF} from './supabase-mcp.mjs';

if (PROJECT_REF !== 'rbuscpwntzpyqsuycqmv') {
  throw new Error(`Projeto Supabase incorreto: ${PROJECT_REF}`);
}

const migrations = await callMcp('list_migrations');
const schema = await callMcp('execute_sql', {
  query: `
    select
      c.relrowsecurity as rls_enabled,
      has_table_privilege(
        'authenticated',
        'public.billing_quotation_item_awards',
        'SELECT'
      ) as authenticated_select,
      has_table_privilege(
        'authenticated',
        'public.billing_quotation_item_awards',
        'DELETE'
      ) as authenticated_delete,
      position(
        'unaward-item' in pg_get_functiondef(
          'billing_private.quotations_dispatch(text,text,jsonb)'::regprocedure
        )
      ) > 0 as unaward_dispatch_ready,
      to_regprocedure('public.billing_rpc(text,text,jsonb)') is not null as public_rpc
    from pg_class c
    where c.oid = 'public.billing_quotation_item_awards'::regclass;
  `,
});

console.log(JSON.stringify({projectRef: PROJECT_REF, migrations, schema}, null, 2));
