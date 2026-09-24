import {PROJECT_REF,callMcp} from './supabase-mcp.mjs';

if(PROJECT_REF!=='rbuscpwntzpyqsuycqmv')throw new Error(`Projeto Supabase incorreto: ${PROJECT_REF}`);

const query=`
select
 strpos(pg_get_functiondef(private_dispatch.oid),'''update-details''')>0 as action_ready,
 private_dispatch.prosecdef as private_dispatch_definer,
 exists(select 1 from unnest(private_dispatch.proconfig) setting where setting like 'search_path=%') as private_dispatch_fixed_path,
 not public_rpc.prosecdef as public_rpc_invoker,
 exists(select 1 from unnest(public_rpc.proconfig) setting where setting like 'search_path=%') as public_rpc_fixed_path,
 not has_function_privilege('anon','billing_private.quotations_dispatch(text,text,jsonb)','EXECUTE') as anon_denied,
 has_function_privilege('authenticated','billing_private.quotations_dispatch(text,text,jsonb)','EXECUTE') as authenticated_ready,
 not has_function_privilege('authenticated','billing_private.quotations_dispatch_before_details_update(text,text,jsonb)','EXECUTE') as previous_private_denied
from pg_proc private_dispatch
cross join pg_proc public_rpc
where private_dispatch.oid='billing_private.quotations_dispatch(text,text,jsonb)'::regprocedure
 and public_rpc.oid='public.billing_rpc(text,text,jsonb)'::regprocedure;
`;

const verification=await callMcp('execute_sql',{query});
const migrations=await callMcp('list_migrations');
console.log(`VERIFY=${JSON.stringify(verification)}`);
console.log(`MIGRATIONS=${JSON.stringify(migrations)}`);
