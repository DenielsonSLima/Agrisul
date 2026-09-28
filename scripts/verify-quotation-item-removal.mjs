import {callMcp, PROJECT_REF} from './supabase-mcp.mjs';

if (PROJECT_REF !== 'rbuscpwntzpyqsuycqmv') {
  throw new Error(`Projeto Supabase incorreto: ${PROJECT_REF}`);
}

const migrations = await callMcp('list_migrations');
const schema = await callMcp('execute_sql', {
  query: `
    select
      position(
        'remove-item' in pg_get_functiondef(
          'billing_private.quotations_dispatch(text,text,jsonb)'::regprocedure
        )
      ) > 0 as removal_dispatch_ready,
      position(
        'billing_quotation_negotiations' in pg_get_functiondef(
          'billing_private.quotations_dispatch(text,text,jsonb)'::regprocedure
        )
      ) > 0 as removal_clears_history,
      position(
        '''canRemove'',p_quote.status=''open''ANDv_item_count>1' in
        regexp_replace(
          pg_get_functiondef(
            'billing_private.quotation_json(public.billing_quotations)'::regprocedure
          ),
          '\\s+',
          '',
          'g'
        )
      ) > 0 as priced_items_removable,
      has_table_privilege(
        'authenticated',
        'public.billing_quotation_items',
        'DELETE'
      ) as authenticated_direct_item_delete,
      has_table_privilege(
        'authenticated',
        'public.billing_quotation_negotiations',
        'DELETE'
      ) as authenticated_direct_history_delete;
  `,
});

console.log(JSON.stringify({projectRef: PROJECT_REF, migrations, schema}, null, 2));
