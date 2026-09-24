import {PROJECT_REF,callMcp} from './supabase-mcp.mjs';

if(PROJECT_REF!=='rbuscpwntzpyqsuycqmv')throw new Error(`Projeto Supabase incorreto: ${PROJECT_REF}`);

const query=`
select
 to_regprocedure('billing_private.quotation_json(public.billing_quotations)') is not null as projection_ready,
 not p.prosecdef as public_rpc_invoker,
 exists(select 1 from unnest(p.proconfig) setting where setting like 'search_path=%') as public_rpc_fixed_path,
 not has_function_privilege('anon','billing_private.quotation_json(public.billing_quotations)','EXECUTE') as anon_private_denied,
 not has_function_privilege('authenticated','billing_private.quotation_json(public.billing_quotations)','EXECUTE') as authenticated_private_denied,
 coalesce((
  select (j ? 'completeProviderCount')
   and (j ? 'pendingAwardCount')
   and (jsonb_array_length(j->'items')=0 or (j->'items'->0) ?& array['materialImageKey','canRemove','removeBlockedReason'])
   and (jsonb_array_length(j->'providers')=0 or (j->'providers'->0) ?& array['canRemove','removeBlockedReason'])
  from public.billing_quotations q
  cross join lateral (select billing_private.quotation_json(q) j) projection
  limit 1
 ),true) as projection_fields_ready
from pg_proc p
where p.oid='public.billing_rpc(text,text,jsonb)'::regprocedure;
`;

const verification=await callMcp('execute_sql',{query});
const migrations=await callMcp('list_migrations');
console.log(`VERIFY=${JSON.stringify(verification)}`);
console.log(`MIGRATIONS=${JSON.stringify(migrations)}`);
