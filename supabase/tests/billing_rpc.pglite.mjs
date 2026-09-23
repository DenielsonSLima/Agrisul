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
try {
 await db.exec(readFileSync(new URL('../migrations/20260922100000_quotations_and_materials.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260922103000_restore_billing_rpc_dispatchers.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260922183938_quotation_supplier_workflow.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260922184239_restore_all_billing_rpc_routes.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260922191137_quotation_comparison_result.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260922193410_quotation_requester_signature.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923110700_material_images.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923111246_fleet_registry.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923113830_material_variants.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923120836_material_product_references.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923122812_material_reference_snapshot_fk.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923123605_material_internal_code.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923125408_purchase_orders_from_quotations.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923131635_purchase_order_fk_indexes.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923132334_material_categories.sql',import.meta.url),'utf8'));
 await db.exec(`
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
   ('95000000-0000-4000-8000-000000000001','quotation-backfill@example.invalid',now());
  INSERT INTO public.billing_materials(id,owner_id,name,code,unit,application) VALUES
   ('95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001','Material legado','LEGACY','kg','');
  INSERT INTO public.billing_service_providers(id,owner_id,document_type,document,legal_name,trade_name) VALUES
   ('95000000-0000-4000-8000-000000000003','95000000-0000-4000-8000-000000000001','CPF','52998224725','Prestador legado','Legado');
  INSERT INTO public.billing_quotations(
   id,owner_id,title,quotation_number,status,request_date,requester,notes
  ) VALUES(
   '95000000-0000-4000-8000-000000000004','95000000-0000-4000-8000-000000000001',
   'Cotação anterior ao histórico','COT-LEGACY','open','2026-09-22','Equipe legada',''
  );
  INSERT INTO public.billing_quotation_items(
   id,owner_id,quotation_id,material_id,material_name,material_code,
   quantity,unit,unit_price,supplier,notes
  ) VALUES(
   '95000000-0000-4000-8000-000000000005','95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000004','95000000-0000-4000-8000-000000000002',
   'Material legado','LEGACY',2,'kg',NULL,'',''
  );
  INSERT INTO public.billing_quotation_providers(
   id,owner_id,quotation_id,provider_id,provider_snapshot
  ) VALUES(
   '95000000-0000-4000-8000-000000000006','95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000004','95000000-0000-4000-8000-000000000003',
   '{"id":"95000000-0000-4000-8000-000000000003","legalName":"Prestador legado","documentType":"CPF","document":"52998224725","tradeName":"Legado"}'::jsonb
  );
  INSERT INTO public.billing_quotation_provider_values(
   owner_id,quotation_id,quotation_provider_id,quotation_item_id,unit_price,created_at,updated_at
  ) VALUES(
   '95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000004',
   '95000000-0000-4000-8000-000000000006','95000000-0000-4000-8000-000000000005',12.34,
   '2026-09-22 10:00:00+00','2026-09-23 11:12:13+00'
  );
 `);
 await db.exec(readFileSync(new URL('../migrations/20260923145913_quotation_negotiation_history.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923154316_allow_quotation_materials_without_references.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923155214_preserve_quotation_internal_code_in_orders.sql',import.meta.url),'utf8'));
 await db.exec(`
  INSERT INTO public.billing_purchase_orders(
   id,owner_id,quotation_id,quotation_provider_id,provider_id,
   created_at,updated_at,order_number,purchase_order_number,payment_method,status,
   quotation_number,quotation_title,quotation_request_date,quotation_requester,
   quotation_notes,provider_snapshot,total
  ) VALUES(
   '95000000-0000-4000-8000-000000000007','95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000004','95000000-0000-4000-8000-000000000006',
   '95000000-0000-4000-8000-000000000003','2026-09-23 12:00:00+00','2026-09-23 12:00:00+00',
   'PED-LEGACY','','','open','COT-LEGACY','Cotação anterior ao histórico','2026-09-22',
   'Equipe legada','',
   '{"id":"95000000-0000-4000-8000-000000000003","legalName":"Prestador legado","documentType":"CPF","document":"52998224725","tradeName":"Legado"}'::jsonb,
   24.68
  );
  INSERT INTO public.billing_purchase_order_items(
   id,owner_id,purchase_order_id,quotation_id,quotation_item_id,created_at,
   material_id,material_name,material_internal_code,material_application,
   material_references,quantity,unit,unit_price,line_total,notes
  ) VALUES(
   '95000000-0000-4000-8000-000000000008','95000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000007','95000000-0000-4000-8000-000000000004',
   '95000000-0000-4000-8000-000000000005','2026-09-23 12:00:00+00',
   '95000000-0000-4000-8000-000000000002','Material legado','LEGACY','',
   '[]'::jsonb,2,'kg',12.34,24.68,''
  );
  UPDATE public.billing_quotations SET status='finished'
  WHERE owner_id='95000000-0000-4000-8000-000000000001'
   AND id='95000000-0000-4000-8000-000000000004';
 `);
 await db.exec(readFileSync(new URL('../migrations/20260923161037_quotation_item_awards_and_scope.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923173330_purchase_order_workspace.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923185900_allow_empty_quotation_providers.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/20260923191551_quotation_scope_removals.sql',import.meta.url),'utf8'));
 await db.exec(`DO $$
  DECLARE v_projection jsonb;
  BEGIN
  IF NOT EXISTS(
   SELECT 1 FROM public.billing_quotation_negotiations
   WHERE owner_id='95000000-0000-4000-8000-000000000001'
    AND quotation_id='95000000-0000-4000-8000-000000000004'
    AND quotation_provider_id='95000000-0000-4000-8000-000000000006'
    AND quotation_item_id='95000000-0000-4000-8000-000000000005'
    AND revision=1 AND unit_price=12.34 AND notes=''
    AND request_id=id
    AND created_at='2026-09-23 11:12:13+00'::timestamptz
  ) THEN RAISE EXCEPTION 'Existing quotation value was not backfilled as version one'; END IF;
  IF NOT EXISTS(
   SELECT 1 FROM public.billing_quotation_item_awards
   WHERE owner_id='95000000-0000-4000-8000-000000000001'
    AND quotation_id='95000000-0000-4000-8000-000000000004'
    AND quotation_item_id='95000000-0000-4000-8000-000000000005'
    AND quotation_provider_id='95000000-0000-4000-8000-000000000006'
    AND created_at='2026-09-23 12:00:00+00'::timestamptz
    AND updated_at='2026-09-23 12:00:00+00'::timestamptz
  ) THEN RAISE EXCEPTION 'Existing purchase order item was not backfilled as an award'; END IF;
  SELECT billing_private.quotation_json(q) INTO v_projection
  FROM public.billing_quotations q
  WHERE q.owner_id='95000000-0000-4000-8000-000000000001'
   AND q.id='95000000-0000-4000-8000-000000000004';
  IF v_projection->>'purchaseOrderId'<>'95000000-0000-4000-8000-000000000007'
   OR v_projection->>'winnerProviderId'<>'95000000-0000-4000-8000-000000000006'
   OR jsonb_array_length(v_projection->'purchaseOrders')<>1
   OR v_projection->'purchaseOrders'->0->>'number'<>'PED-LEGACY'
   OR v_projection->'purchaseOrders'->0->>'total'<>'24.68'
   OR v_projection->'purchaseOrders'->0 ? 'items' THEN
   RAISE EXCEPTION 'Quotation order summary/backfill projection is invalid: %',v_projection;
  END IF;
 END $$;
 DELETE FROM auth.users WHERE id='95000000-0000-4000-8000-000000000001';
 DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.billing_quotation_negotiations
   WHERE owner_id='95000000-0000-4000-8000-000000000001') THEN
   RAISE EXCEPTION 'Workspace deletion did not cascade negotiation history';
  END IF;
  IF EXISTS(SELECT 1 FROM public.billing_quotation_item_awards
   WHERE owner_id='95000000-0000-4000-8000-000000000001') THEN
   RAISE EXCEPTION 'Workspace deletion did not cascade item awards';
  END IF;
 END $$;`);
 await db.exec(`DO $$
 DECLARE v_rpc text:=pg_get_functiondef('public.billing_rpc(text,text,jsonb)'::regprocedure);
  v_authorize text:=pg_get_functiondef('billing_private.authorize_resource(text,text)'::regprocedure);
  v_negotiation_dispatch text:=pg_get_functiondef('billing_private.quotations_dispatch_before_item_awards(text,text,jsonb)'::regprocedure);
  v_route text;v_is_definer boolean;v_config text[];v_rls boolean;v_replica "char";
 BEGIN
  FOREACH v_route IN ARRAY ARRAY[
   'document-templates','service-providers','signatures','service-requests','home',
   'settings','users','access-profiles','report-headers','agenda','summary','reports','planning',
   'materials','quotations','contracts','cultural-practices','atr','farms','companies','watermarks'
  ] LOOP
   IF strpos(v_rpc,quote_literal(v_route))=0 THEN RAISE EXCEPTION 'RPC route lost after quotation migration: %',v_route; END IF;
  END LOOP;
  IF strpos(v_authorize,'billing_private.has_permission(''requests.read'')')=0 THEN
   RAISE EXCEPTION 'Request readers lost watermark access after quotation migration';
  END IF;
  IF strpos(v_authorize,'''quotations''')=0 OR strpos(v_authorize,'''quotations.''')<>0 THEN
   RAISE EXCEPTION 'Quotations must reuse registrations.read/write permissions';
  END IF;
  IF strpos(v_negotiation_dispatch,'''record-negotiation''')=0
   OR strpos(v_negotiation_dispatch,'pg_advisory_xact_lock')=0
   OR strpos(v_negotiation_dispatch,'FOR SHARE')=0 THEN
   RAISE EXCEPTION 'Negotiation dispatcher lost its action or concurrency guards';
  END IF;
  SELECT c.relrowsecurity,c.relreplident INTO v_rls,v_replica
  FROM pg_class c WHERE c.oid='public.billing_quotation_negotiations'::regclass;
  IF NOT v_rls OR v_replica<>'f'
   OR has_table_privilege('authenticated','public.billing_quotation_negotiations','INSERT')
   OR has_table_privilege('authenticated','public.billing_quotation_negotiations','UPDATE')
   OR has_table_privilege('authenticated','public.billing_quotation_negotiations','DELETE')
   OR NOT has_table_privilege('authenticated','public.billing_quotation_negotiations','SELECT')
   OR NOT EXISTS(
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.billing_quotation_negotiations'::regclass
     AND c.contype='u'
     AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (owner_id, quotation_id, quotation_provider_id, quotation_item_id, revision)%'
   ) THEN
   RAISE EXCEPTION 'Negotiation history RLS, Realtime identity, grants or version uniqueness are unsafe';
  END IF;
  SELECT p.prosecdef,p.proconfig INTO v_is_definer,v_config FROM pg_proc p
   WHERE p.oid='public.billing_rpc(text,text,jsonb)'::regprocedure;
  IF v_is_definer OR NOT EXISTS(SELECT 1 FROM unnest(v_config) setting WHERE setting LIKE 'search_path=%') THEN
   RAISE EXCEPTION 'Public RPC must remain SECURITY INVOKER with a fixed search path';
  END IF;
 END $$;
 BEGIN;
 RESET ROLE;
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('7a000000-0000-4000-8000-000000000001','quotation-owner@example.invalid',now()),
  ('7a000000-0000-4000-8000-000000000002','quotation-reader@example.invalid',now());
 SET LOCAL ROLE authenticated;
 SELECT set_config('request.jwt.claim.sub','7a000000-0000-4000-8000-000000000001',true);
 SELECT public.billing_rpc('settings','get','{}');
 RESET ROLE;
 INSERT INTO public.billing_access_profiles(id,owner_id,name,permissions) VALUES
  ('7a000000-0000-4000-8000-000000000003','7a000000-0000-4000-8000-000000000001','Quotation reader',ARRAY['registrations.read']);
 INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status) VALUES
  ('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000002','7a000000-0000-4000-8000-000000000003',false,'active');
 SET LOCAL ROLE authenticated;
 SELECT set_config('request.jwt.claim.sub','7a000000-0000-4000-8000-000000000002',true);
 DO $$ DECLARE v_result jsonb; BEGIN
  v_result=public.billing_rpc('quotations','list','{"status":"open"}');
  IF v_result->'quotes'<>'[]'::jsonb THEN RAISE EXCEPTION 'Unexpected quotation reader result: %',v_result; END IF;
 END $$;
 RESET ROLE;
 ROLLBACK;`);
 console.log('Quotation integration preserves providers, requests, templates, home, watermark access and all prior RPC routes');
 await db.exec(readFileSync(new URL('./material_images.sql',import.meta.url),'utf8'));
 console.log('Materials: optional application, private optimized-image references and workspace isolation passed');
 await db.exec(readFileSync(new URL('./material_variants.sql',import.meta.url),'utf8'));
 console.log('Materials: clickable products, one product photo, equivalent references and workspace isolation passed');
 await db.exec(readFileSync(new URL('./fleet_registry.sql',import.meta.url),'utf8'));
 console.log('Fleet: vehicle registry, optional description, permissions and workspace isolation passed');
 await db.exec(readFileSync(new URL('./quotation_supplier_workflow.sql',import.meta.url),'utf8'));
 console.log('Quotation workflow: append-only negotiation versions, comparison matrix, explicit winner, snapshots, purchase-order finalization, permissions and isolation passed');
 await db.exec(readFileSync(new URL('./purchase_orders.sql',import.meta.url),'utf8'));
 console.log('Purchase orders: atomic idempotent finalization, snapshots, payment fields, permissions and isolation passed');
 await db.exec(readFileSync(new URL('./quotation_item_awards.sql',import.meta.url),'utf8'));
 console.log('Quotation item awards: incremental scope, exact decisions, split orders, retries, permissions and isolation passed');
 await db.exec(readFileSync(new URL('./material_categories.sql',import.meta.url),'utf8'));
 console.log('Material categories: normalized names, optional links, deletion guard, permissions and isolation passed');
} catch(e) {console.error(e.message,e.where,e.position);process.exit(1);}
await db.close();
