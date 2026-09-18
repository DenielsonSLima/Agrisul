// Optional local test engine (kept out of production dependencies).
// npm install --prefix /tmp/billing-pg-tests @electric-sql/pglite@0.3.14
// BILLING_PGLITE_MODULE=/tmp/billing-pg-tests/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/billing_rpc.pglite.mjs
const {PGlite}=await import(process.env.BILLING_PGLITE_MODULE || '@electric-sql/pglite');
import {readFileSync} from 'node:fs';
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;`);
const migrations=[
 '../migrations/20260915022418_billing_settings_and_registrations_rpc.sql',
 '../migrations/20260915030048_company_logos.sql',
 '../migrations/20260915031921_orientation_watermarks.sql',
 '../migrations/20260915114606_workspace_access_and_report_headers.sql',
 '../migrations/20260915121952_farm_summary_metrics.sql',
 '../migrations/20260915122812_atr_monthly_accumulated_quotes.sql',
 '../migrations/20260915124656_planning_entries.sql',
 '../migrations/20260915125848_rename_cultural_practices_to_management.sql',
 '../migrations/20260915130832_atr_server_pagination.sql',
 '../migrations/20260915132330_atr_gross_and_net_quotes.sql',
 '../migrations/20260915141115_seed_sugarcane_management.sql',
 '../migrations/20260915141643_contracts_operational_module.sql',
 '../migrations/20260915143857_simplify_management_categories.sql',
 '../migrations/20260915144334_planning_operations_and_kpis.sql',
 '../migrations/20260915144940_contracts_active_lifecycle.sql',
 '../migrations/20260915161020_contract_atr_billing.sql',
 '../migrations/20260915161252_active_company_contract_scope.sql',
 '../migrations/20260915163040_harden_active_company_contract_scope.sql',
 '../migrations/20260915163401_contract_monthly_summary.sql',
 '../migrations/20260915165454_flexible_planning_goals_and_executions.sql',
 '../migrations/20260915171656_contract_number.sql',
 '../migrations/20260915172547_contract_financial_entries.sql',
 '../migrations/20260915173326_contract_loads_workspace.sql',
 '../migrations/20260915180641_contract_loads_previous_month_atr.sql',
 '../migrations/20260915181138_field_diaries_and_period_reports.sql',
 '../migrations/20260915181436_contracts_list_summary.sql',
 '../migrations/20260915181829_restore_load_atr_billing.sql',
 '../migrations/20260915184442_contracts_report_atr_quote.sql',
 '../migrations/20260915184718_contract_discount_monthly_breakdown.sql',
 '../migrations/20260915194313_contract_load_financial_columns.sql',
 '../migrations/20260915195837_contract_load_financial_kpis.sql',
];
try{
 for(const path of migrations){
  if(path.endsWith('20260915144334_planning_operations_and_kpis.sql'))await db.exec(`
   INSERT INTO auth.users(id,email) VALUES('44444444-4444-4444-8444-444444444444','legacy-planning@example.invalid');
   INSERT INTO public.billing_farms(id,owner_id,name,area_ha,city,state)
    VALUES('44444444-4444-4444-8444-444444444445','44444444-4444-4444-8444-444444444444','Fazenda legada',10,'Cidade','SP');
   INSERT INTO public.billing_farm_plots(id,owner_id,farm_id,name,area_ha)
    VALUES('44444444-4444-4444-8444-444444444446','44444444-4444-4444-8444-444444444444','44444444-4444-4444-8444-444444444445','Talhão legado',10);
   INSERT INTO public.billing_planning_entries(owner_id,module,farm_id,plot_id,area_ha) VALUES
    ('44444444-4444-4444-8444-444444444444','herbicidas','44444444-4444-4444-8444-444444444445','44444444-4444-4444-8444-444444444446',10),
    ('44444444-4444-4444-8444-444444444444','quebra-de-lombo','44444444-4444-4444-8444-444444444445','44444444-4444-4444-8444-444444444446',10),
    ('44444444-4444-4444-8444-444444444444','mudas','44444444-4444-4444-8444-444444444445','44444444-4444-4444-8444-444444444446',10);
  `);
  await db.exec(readFileSync(new URL(path,import.meta.url),'utf8'));
 }
 await db.exec(`DO $$ BEGIN
  IF (SELECT count(*) FROM public.billing_planning_entries
      WHERE owner_id='44444444-4444-4444-8444-444444444444' AND module='manejo-do-canavial')<>2
     OR (SELECT count(*) FROM public.billing_planning_entries
      WHERE owner_id='44444444-4444-4444-8444-444444444444' AND module='plantio')<>1
     OR EXISTS(SELECT 1 FROM public.billing_planning_entries
      WHERE owner_id='44444444-4444-4444-8444-444444444444'
       AND (activity_type IS NULL OR planned_start_date IS NULL OR planned_end_date IS NULL)) THEN
   RAISE EXCEPTION 'Legacy planning migration did not preserve and classify rows';
  END IF;
 END $$;
 DELETE FROM auth.users WHERE id='44444444-4444-4444-8444-444444444444';`);
 console.log('Migrations compiled successfully');
}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
try{await db.exec(readFileSync(new URL('./billing_rpc.sql',import.meta.url),'utf8'));console.log('RPC and RLS behavioral tests passed');}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
try{await db.exec(readFileSync(new URL('./planning_periods.sql',import.meta.url),'utf8'));console.log('Flexible periods and partial execution behavioral tests passed');}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
try{await db.exec(readFileSync(new URL('./field_diaries.sql',import.meta.url),'utf8'));console.log('Field diaries: metadata, filtered reports, exact groups, retries, voids, goal totals and isolation passed');}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
try{await db.exec(readFileSync(new URL('./contract_finance.sql',import.meta.url),'utf8'));console.log('Contract finance: monthly deductions, balances, precision, revisions, retries and isolation passed');}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
try{await db.exec(readFileSync(new URL('./contract_discount_breakdown.sql',import.meta.url),'utf8'));console.log('Contract discount breakdown: per-month agreement values, notes, rounding, empty months, edits and isolation passed');}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
try{await db.exec(readFileSync(new URL('./contract_loads.sql',import.meta.url),'utf8'));console.log('Contract loads: filters, groups, exact totals, weighted ATR and isolation passed');}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
try{await db.exec(readFileSync(new URL('./contract_load_atr.sql',import.meta.url),'utf8'));console.log('Contract ATR: four criteria, previous month/year, date edits, quote edits, pending values, rounding and legacy isolation passed');}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
try{await db.exec(readFileSync(new URL('./contract_load_financials.sql',import.meta.url),'utf8'));console.log('Load financials: monthly cents, agreement rounding, four ATR criteria, pending/zero/negative values, filters, edits, finance parity and isolation passed');}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
try{await db.exec(readFileSync(new URL('./contract_previous_month_atr.sql',import.meta.url),'utf8'));console.log('Contract ATR: independent load ATR, previous quotation month, year boundary, leap year and isolation passed');}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
try{await db.exec(readFileSync(new URL('./contracts_list_summary.sql',import.meta.url),'utf8'));console.log('Contract list KPIs: filtered scope, weighted ATR, finance parity, credit isolation, missing quotes and account isolation passed');}catch(e){console.error(e.message,e.where,e.position);process.exit(1)}
// Historical planning behavior above is verified before the removal migration.
try {
 await db.exec(readFileSync(new URL('../migrations/20260916103918_agenda_summary_reports.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./agenda_summary_reports.sql',import.meta.url),'utf8'));
 console.log('Agenda, summary, reports and Acompanhamento removal behavioral tests passed');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
try {
 await db.exec(readFileSync(new URL('../migrations/20260916142228_planning_period_allocations.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916144506_planning_fk_indexes.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916145038_planning_conflict_status.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916152735_planning_season_daily_dashboard.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916154602_planning_season_fk_indexes.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916154732_planning_dashboard_hardening.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916155858_planning_search_pagination_export.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916161816_planning_automatic_harvest_scope.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916163136_planning_farm_plot_comparison.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916170752_planning_harvest_target_distribution.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916175817_planning_field_log_details.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260916182052_planning_diary_period_summary.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./planning_period_allocations.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./planning_season_daily_dashboard.sql',import.meta.url),'utf8'));
 console.log('Planning periods, planted baselines, allocations, management, remanagement and history passed');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
try {
 await db.exec(readFileSync(new URL('../migrations/20260917112621_harden_user_invites_and_onboarding.sql',import.meta.url),'utf8'));
 console.log('Secure invitations and onboarding migration compiled successfully');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
try {
 await db.exec(readFileSync(new URL('./user_access_lifecycle.sql',import.meta.url),'utf8'));
 console.log('User invitations, onboarding, inactivity states and hierarchy passed');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
try {
 await db.exec(readFileSync(new URL('../migrations/20260917121117_executive_summary_dashboard.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260917121327_general_load_report_financial_groups.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260917122127_contract_closure_refunds.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260917140943_executive_summary_operational_intelligence.sql',import.meta.url),'utf8'));
 console.log('Executive summary, operational intelligence and detailed load report migrations compiled successfully');
 await db.exec(readFileSync(new URL('./contract_closure_refunds.sql',import.meta.url),'utf8'));
 console.log('Contract closure and advance refunds passed');
 await db.exec(readFileSync(new URL('./executive_summary_dashboard.sql',import.meta.url),'utf8'));
 console.log('Executive summary: inclusive dates, finance, planning focus, defaults, decimals and isolation passed');
 await db.exec(readFileSync(new URL('./load_report_filters.sql',import.meta.url),'utf8'));
 console.log('Load report: inclusive filters, origins, financial KPIs, contract subtotals and isolation passed');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
try {
 await db.exec(readFileSync(new URL('../migrations/20260917150546_service_requests_signatures.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260917152024_service_requests_action_validation.sql',import.meta.url),'utf8'));
 console.log('Service requests and signatures migration compiled successfully');
 await db.exec(readFileSync(new URL('./service_requests.sql',import.meta.url),'utf8'));
 console.log('Service requests: signatures, immutable files, decisions, retries, filters, permissions and workspace isolation passed');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
try {
 await db.exec(readFileSync(new URL('./service_request_people_before.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260917155919_service_request_people_and_operators.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./service_request_people.sql',import.meta.url),'utf8'));
 console.log('Requester people: legacy snapshots, people without accounts, operator audit, manager identity, selection, retries and isolation passed');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
try {
 // Previous fixture deliberately rolls back its migration. Recreate legacy rows
 // and apply the people migration before checking the new document snapshots.
 await db.exec(readFileSync(new URL('./service_request_people_before.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260917155919_service_request_people_and_operators.sql',import.meta.url),'utf8'));
 await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
  SELECT set_config('test.manual.legacy',(public.billing_rpc('service-requests','get','{"id":"72000000-0000-4000-8000-000000000020"}')->'request')::text,true); RESET ROLE;`);
 await db.exec(readFileSync(new URL('../migrations/20260918112906_service_request_manual_signatures_templates.sql',import.meta.url),'utf8'));
 console.log('Manual signatures, document templates and record hashes migration compiled successfully');
 await db.exec(readFileSync(new URL('../migrations/20260918125410_service_providers_registry.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./service_providers.sql',import.meta.url),'utf8'));
 console.log('Providers: CPF/CNPJ, duplicates, server-derived request snapshots, retries, immutable hashes, permissions and isolation passed');
 await db.exec(readFileSync(new URL('../migrations/20260918131759_service_request_optional_details.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260918133722_service_request_complement_conflict.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./service_request_complements.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260918134159_service_request_report_header.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./service_request_report_header.sql',import.meta.url),'utf8'));
 console.log('Request report headers: portrait settings, selected company, request-only readers and private logo isolation passed');
 console.log('Optional request details, approved complements, retries, conflicts, snapshots and isolation passed');
 await db.exec(readFileSync(new URL('../migrations/20260918145206_service_request_pending_complements.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./service_request_pending_complements.sql',import.meta.url),'utf8'));
 console.log('Pending request complements: private PDF upload, versioned approval evidence, later additions, retries, permissions and isolation passed');
 await db.exec(readFileSync(new URL('../migrations/20260918151219_service_request_execution_status.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./service_request_execution_status.sql',import.meta.url),'utf8'));
 console.log('Service execution: open/in-progress/completed states, audited completion, immutable approval, retries, filtered pagination and isolation passed');
 await db.exec(readFileSync(new URL('./service_request_documents.sql',import.meta.url),'utf8'));
 console.log('Document workflow: optional PNG/budget, manual choices, immutable templates and hashes, layout validation, audit and isolation passed');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
try {
 await db.exec(readFileSync(new URL('../migrations/20260918121253_service_request_watermark_access.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./service_request_watermark.sql',import.meta.url),'utf8'));
 console.log('Document watermarks: request reader, private storage, Realtime isolation, no writes and permission revocation passed');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
try {
 // Document fixtures roll back the migrations applied inside their transaction.
 // Restore the current schema before exercising the home projection end to end.
 for (const migration of [
  '20260917155919_service_request_people_and_operators.sql',
  '20260918112906_service_request_manual_signatures_templates.sql',
  '20260918125410_service_providers_registry.sql',
  '20260918131759_service_request_optional_details.sql',
  '20260918133722_service_request_complement_conflict.sql',
  '20260918134159_service_request_report_header.sql',
  '20260918145206_service_request_pending_complements.sql',
  '20260918151219_service_request_execution_status.sql',
 ]) await db.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260918162432_home_dashboard.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('./home_dashboard.sql',import.meta.url),'utf8'));
 console.log('Home dashboard: company finance, deadlines, current request details, planning, empty states, permissions and isolation passed');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
await db.close();
