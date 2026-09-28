import {PROJECT_REF,callMcp} from './supabase-mcp.mjs';

if(PROJECT_REF!=='rbuscpwntzpyqsuycqmv')throw new Error(`Projeto Supabase incorreto: ${PROJECT_REF}`);

const query=`
select
 exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='billing_quotation_provider_values' and column_name='discount_type') as current_discount_ready,
 exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='billing_quotation_negotiations' and column_name='discount_value') as history_discount_ready,
 exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='billing_purchase_order_items' and column_name='discount_amount') as order_snapshot_ready,
 to_regprocedure('billing_private.quotation_discount_amount(numeric,numeric,text,numeric)') is not null as calculation_ready,
 strpos(pg_get_functiondef(dispatcher.oid),'''discountType''')>0 as dispatcher_ready,
 dispatcher.prosecdef as dispatcher_definer,
 exists(select 1 from unnest(dispatcher.proconfig) setting where setting like 'search_path=%') as dispatcher_fixed_path,
 not has_function_privilege('anon','billing_private.quotations_dispatch(text,text,jsonb)','EXECUTE') as anon_denied,
 has_function_privilege('authenticated','billing_private.quotations_dispatch(text,text,jsonb)','EXECUTE') as authenticated_ready,
 not has_table_privilege('authenticated','public.billing_quotation_provider_values','UPDATE') as direct_value_update_denied,
 not has_table_privilege('authenticated','public.billing_quotation_negotiations','INSERT') as direct_history_insert_denied,
 coalesce((select (j->'providers'->0) ? 'offers'
  from public.billing_quotations q
  cross join lateral (select billing_private.quotation_json(q) j) projection
  limit 1),true) as projection_ready
 ,coalesce((select j ? 'awardedTotal'
  from public.billing_quotations q
  cross join lateral (select billing_private.quotation_json(q) j) projection
  limit 1),true) as awarded_total_projection_ready
from pg_proc dispatcher
where dispatcher.oid='billing_private.quotations_dispatch(text,text,jsonb)'::regprocedure;
`;

const verification=await callMcp('execute_sql',{query});
const migrations=await callMcp('list_migrations');
const securityAdvisors=await callMcp('get_advisors',{type:'security'});
const performanceAdvisors=await callMcp('get_advisors',{type:'performance'});
console.log(`VERIFY=${JSON.stringify(verification)}`);
console.log(`MIGRATIONS=${JSON.stringify(migrations)}`);
console.log(`SECURITY_ADVISORS=${JSON.stringify(securityAdvisors)}`);
console.log(`PERFORMANCE_ADVISORS=${JSON.stringify(performanceAdvisors)}`);
