import {PROJECT_REF,callMcp} from './supabase-mcp.mjs';

if(PROJECT_REF!=='rbuscpwntzpyqsuycqmv')throw new Error(`Projeto Supabase incorreto: ${PROJECT_REF}`);

const query=`
select
 strpos(pg_get_functiondef(dispatch.oid),'''delete''')>0 as delete_action_ready,
 dispatch.prosecdef as dispatch_definer,
 exists(select 1 from unnest(dispatch.proconfig) setting where setting like 'search_path=%') as fixed_search_path,
 has_function_privilege('authenticated','billing_private.contracts_company_dispatch(text,jsonb)','EXECUTE') as authenticated_execute,
 not has_function_privilege('anon','billing_private.contracts_company_dispatch(text,jsonb)','EXECUTE') as anon_denied,
 to_regprocedure('billing_private.contracts_before_contract_deletion_dispatch(text,jsonb)') is not null as previous_dispatch_exists,
 not coalesce(has_function_privilege('authenticated',to_regprocedure('billing_private.contracts_before_contract_deletion_dispatch(text,jsonb)'),'EXECUTE'),false) as previous_dispatch_denied,
 not has_table_privilege('authenticated','public.billing_contracts','DELETE') as direct_delete_denied,
 (select count(*)=3 from pg_constraint where confrelid='public.billing_contracts'::regclass and contype='f' and confdeltype='c') as three_cascades_ready
from pg_proc dispatch
where dispatch.oid='billing_private.contracts_company_dispatch(text,jsonb)'::regprocedure;
`;

const migrations=await callMcp('list_migrations');
const schema=await callMcp('execute_sql',{query});
console.log(JSON.stringify({projectRef:PROJECT_REF,migrations,schema},null,2));
