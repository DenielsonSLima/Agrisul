import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {QueryClient} from '@tanstack/react-query';
import {billingKeys} from '../shared/query/keys.ts';
import {realtimeResources} from '../shared/query/realtimeResources.ts';
import {mutationResources} from '../shared/query/derivedResources.ts';

const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
try{
 const key=(owner,resource,params={})=>[...billingKeys.resource(owner,resource),params];
 const aFarm=key('owner-a','farms');
 const aPlotOne=key('owner-a','plots',{farmId:'farm-one'});
 const aPlotTwo=key('owner-a','plots',{farmId:'farm-two'});
 const aCompanies=key('owner-a','companies');
 const aManagement=key('owner-a','cultural-practices',{cultureId:'culture-one',cultureSubtypeId:'subtype-one'});
 const aContracts=key('owner-a','contracts',{view:'detail',id:'contract-one'});
 const aPlanning=key('owner-a','planning',{periodId:'period-one',section:'historico'});
 const bFarm=key('owner-b','farms');
 const bPlots=key('owner-b','plots',{farmId:'farm-one'});
 const bManagement=key('owner-b','cultural-practices',{cultureId:'culture-one',cultureSubtypeId:'subtype-one'});
 const bContracts=key('owner-b','contracts',{view:'detail',id:'contract-one'});
 const bPlanning=key('owner-b','planning',{periodId:'period-one',section:'historico'});
 for(const queryKey of [aFarm,aPlotOne,aPlotTwo,aCompanies,aManagement,aContracts,aPlanning,bFarm,bPlots,bManagement,bContracts,bPlanning])client.setQueryData(queryKey,{source:queryKey[1]});
 for(const resource of realtimeResources.billing_farm_plots){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 for(const queryKey of [aFarm,aPlotOne,aPlotTwo])assert.equal(client.getQueryState(queryKey).isInvalidated,true);
 for(const queryKey of [aCompanies,bFarm,bPlots])assert.equal(client.getQueryState(queryKey).isInvalidated,false);
 assert.deepEqual(client.getQueryData(bPlots),{source:'owner-b'});

 // Culture and subtype labels are embedded in management entries.
 client.setQueryData(aManagement,{saved:true});
 for(const table of ['billing_cultures','billing_culture_subtypes']){
  await Promise.all(realtimeResources[table].map(resource=>client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'})));
 }
 assert.equal(client.getQueryState(aManagement).isInvalidated,true);

 // Local culture/subtype writes refresh the labels embedded in management and
 // planning snapshots even while Realtime is unavailable.
 for(const queryKey of [aManagement,aPlanning,bManagement,bPlanning])client.setQueryData(queryKey,{saved:true});
 for(const resource of mutationResources('cultures',['cultural-practices','planning'])){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aManagement).isInvalidated,true);
 assert.equal(client.getQueryState(aPlanning).isInvalidated,true);
 assert.equal(client.getQueryState(bManagement).isInvalidated,false);
 assert.equal(client.getQueryState(bPlanning).isInvalidated,false);

 for(const resource of realtimeResources.billing_contract_loads){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aContracts).isInvalidated,true);

 // ATR quotations feed contract billing. The mutation fallback must update
 // contract projections without touching another signed-in account.
 for(const queryKey of [aContracts,bContracts])client.setQueryData(queryKey,{saved:true});
 for(const resource of mutationResources('atr',['contracts'])){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aContracts).isInvalidated,true);
 assert.equal(client.getQueryState(bContracts).isInvalidated,false);

 for(const table of ['billing_contract_payments','billing_contract_discounts']){
  client.setQueryData(aContracts,{saved:true});
  for(const resource of realtimeResources[table])await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
  assert.equal(client.getQueryState(aContracts).isInvalidated,true,table+' refreshes contract balances');
 }

 // Category writes and Realtime events refresh both the category registry and
 // every cached material projection, without touching another workspace.
 const aCategories=key('owner-a','material-categories',{view:'list'});
 const aMaterials=key('owner-a','materials',{view:'list'});
 const bCategories=key('owner-b','material-categories',{view:'list'});
 const bMaterials=key('owner-b','materials',{view:'list'});
 for(const queryKey of [aCategories,aMaterials,bCategories,bMaterials])client.setQueryData(queryKey,{saved:true});
 assert.deepEqual(mutationResources('material-categories'),['material-categories','materials']);
 for(const resource of realtimeResources.billing_material_categories){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aCategories).isInvalidated,true);
 assert.equal(client.getQueryState(aMaterials).isInvalidated,true);
 assert.equal(client.getQueryState(bCategories).isInvalidated,false);
 assert.equal(client.getQueryState(bMaterials).isInvalidated,false);

 // Finalizing a quotation creates an order in the same transaction. Both
 // mutation fallback and Realtime therefore refresh the order projections.
 const aQuotes=key('owner-a','quotations',{view:'detail',id:'quote-one'});
 const aOrders=key('owner-a','purchase-orders',{view:'list'});
 const bOrders=key('owner-b','purchase-orders',{view:'list'});
 for(const queryKey of [aQuotes,aOrders,bOrders])client.setQueryData(queryKey,{saved:true});
 assert.deepEqual(mutationResources('quotations'),['quotations','purchase-orders']);
 for(const resource of realtimeResources.billing_quotations){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aQuotes).isInvalidated,true);
 assert.equal(client.getQueryState(aOrders).isInvalidated,true);

 // Payment methods are selected by orders, so registry mutations and
 // Realtime changes refresh both projections for the active workspace.
 const aPaymentMethods=key('owner-a','payment-methods',{view:'list'});
 const bPaymentMethods=key('owner-b','payment-methods',{view:'list'});
 for(const queryKey of [aPaymentMethods,bPaymentMethods])client.setQueryData(queryKey,{saved:true});
 assert.deepEqual(mutationResources('payment-methods'),['payment-methods','purchase-orders']);
 for(const resource of realtimeResources.billing_payment_methods){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aPaymentMethods).isInvalidated,true);
 assert.equal(client.getQueryState(aOrders).isInvalidated,true);
 assert.equal(client.getQueryState(bPaymentMethods).isInvalidated,false);
 assert.equal(client.getQueryState(bOrders).isInvalidated,false);

 // Provider contacts refresh both the provider detail and purchase-order contact choices.
 const aProviders=key('owner-a','service-providers',{view:'detail',id:'provider-a'});
 client.setQueryData(aProviders,{saved:true});client.setQueryData(aOrders,{saved:true});
 for(const resource of realtimeResources.billing_service_provider_contacts){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aProviders).isInvalidated,true);
 assert.equal(client.getQueryState(aOrders).isInvalidated,true);

 client.setQueryData(aQuotes,{saved:true});
 for(const resource of realtimeResources.billing_quotation_negotiations){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aQuotes).isInvalidated,true,'negotiation history refreshes quotation projections');

 client.setQueryData(aQuotes,{saved:true});
 for(const resource of realtimeResources.billing_quotation_item_awards){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aQuotes).isInvalidated,true,'item awards refresh quotation projections');

 client.setQueryData(aOrders,{saved:true});
 for(const resource of realtimeResources.billing_purchase_order_items){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aOrders).isInvalidated,true);

 // A profile event refreshes every presentation of the same saved account.
 for(const resource of ['settings','profile','users','watermarks','watermark'])client.setQueryData(key('owner-a',resource),{saved:true});
 for(const table of ['billing_profiles','billing_watermarks']){
  await Promise.all(realtimeResources[table].map(resource=>client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'})));
 }
 for(const resource of ['settings','profile','users','watermarks','watermark'])assert.equal(client.getQueryState(key('owner-a',resource)).isInvalidated,true);

 // Workspace membership, permissions and report branding invalidate every dependent view.
 for(const resource of ['users','access-profiles','permissions','settings','profile','report-headers'])client.setQueryData(key('owner-a',resource),{saved:true});
 for(const table of ['billing_memberships','billing_access_profiles','billing_user_settings','billing_report_headers']){
  await Promise.all(realtimeResources[table].map(resource=>client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'})));
 }
 for(const resource of ['users','access-profiles','permissions','settings','profile','report-headers'])assert.equal(client.getQueryState(key('owner-a',resource)).isInvalidated,true);

 // Planning history and diary rows embed the saved operator name.
 for(const queryKey of [aPlanning,bPlanning])client.setQueryData(queryKey,{saved:true});
 for(const resource of realtimeResources.billing_user_settings){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aPlanning).isInvalidated,true);
 assert.equal(client.getQueryState(bPlanning).isInvalidated,false);

 // Approval and signature changes invalidate lists, detail and options together.
 for(const table of ['billing_signatures','billing_request_files','billing_service_requests','billing_service_request_events', 'billing_service_request_complements','billing_document_templates','billing_service_providers','billing_report_headers','billing_companies']){
  const detail=key('owner-a','service-requests',{id:'request-a'});
  const list=key('owner-a','service-requests',{status:'pending',page:1});
  const other=key('owner-b','service-requests',{id:'request-b'});
  for(const queryKey of [detail,list,other])client.setQueryData(queryKey,{saved:true});
  for(const resource of realtimeResources[table])await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
  assert.equal(client.getQueryState(detail).isInvalidated,true);
  assert.equal(client.getQueryState(list).isInvalidated,true);
  assert.equal(client.getQueryState(other).isInvalidated,false);
 }

 for(const table of ['billing_document_templates','billing_memberships','billing_access_profiles']){
  const mine=key('owner-a','document-templates',{key:'service-request'}),other=key('owner-b','document-templates');
  client.setQueryData(mine,{version:1});client.setQueryData(other,{version:3});
  for(const resource of realtimeResources[table])await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
  assert.equal(client.getQueryState(mine).isInvalidated,true,table+' refreshes template or authorization');
  assert.equal(client.getQueryState(other).isInvalidated,false);
 }

 // Home projections refresh across companies and months without touching another account.
 for(const table of ['billing_contract_loads','billing_contract_payments','billing_contract_discounts','billing_atr_records',
  'billing_companies','billing_clients','billing_farms','billing_farm_plots','billing_planning_field_logs','billing_planning_periods',
  'billing_planning_allocations','billing_planning_harvest_targets','billing_service_requests','billing_service_request_complements',
  'billing_service_providers','billing_memberships','billing_access_profiles']){
  const homeA=key('owner-a','home',{companyId:'one',month:'2026-09'}),homeB=key('owner-a','home',{companyId:'two',month:'2026-08'}),foreign=key('owner-b','home');
  for(const k of [homeA,homeB,foreign])client.setQueryData(k,{saved:true});
  for(const resource of realtimeResources[table])await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
  assert.equal(client.getQueryState(homeA).isInvalidated,true,table+' refreshes home');
  assert.equal(client.getQueryState(homeB).isInvalidated,true,table+' refreshes other cached months');
  assert.equal(client.getQueryState(foreign).isInvalidated,false);
 }

 // Switching accounts must abort previous reads and prevent their late results
 // from restoring the old account's cache after it has been cleared.
 let finish;
 let aborted=false;
 const previous=client.fetchQuery({queryKey:key('owner-a','slow-read'),queryFn:({signal})=>{
  signal.addEventListener('abort',()=>{aborted=true;},{once:true});
  return new Promise(resolve=>{finish=resolve;});
 }}).catch(error=>error);
 await client.cancelQueries();
 client.clear();
 client.setQueryData(bFarm,{source:'owner-b-new-session'});
 finish({source:'owner-a-late-result'});
 await previous;
 assert.equal(aborted,true);
 assert.equal(client.getQueryData(key('owner-a','slow-read')),undefined);
 assert.deepEqual(client.getQueryData(bFarm),{source:'owner-b-new-session'});
 assert.equal(client.getQueryCache().findAll({queryKey:billingKeys.all('owner-a')}).length,0);

 // A focus/visibility refetch must update the remote material lists without
 // replacing the controlled dialog or its local draft (including the File).
 // Only an initial pending query may switch the page to its loading state.
 const [materialsSource,quoteCreateSource,cotacaoPageSource,cadastroQuerySource,atrHookSource,settingsHookSource,culturesHookSource,practicesHookSource]=await Promise.all([
  readFile(new URL('../modules/cadastro/materiais/components/MateriaisPage.tsx',import.meta.url),'utf8'),
  readFile(new URL('../modules/cotacao/components/QuoteCreatePage.tsx',import.meta.url),'utf8'),
  readFile(new URL('../modules/cotacao/components/CotacaoPage.tsx',import.meta.url),'utf8'),
  readFile(new URL('../modules/cadastro/hooks/useCadastroQuery.ts',import.meta.url),'utf8'),
  readFile(new URL('../modules/cadastro/atr/hooks/useAtr.ts',import.meta.url),'utf8'),
  readFile(new URL('../modules/configuracoes/hooks/useSettings.ts',import.meta.url),'utf8'),
  readFile(new URL('../modules/cadastro/culturas/hooks/useCultures.ts',import.meta.url),'utf8'),
  readFile(new URL('../modules/cadastro/tratos-culturais/hooks/usePractices.ts',import.meta.url),'utf8'),
 ]);
 assert.match(materialsSource,/<Dialog open=\{materialOpen\}/);
 assert.match(materialsSource,/<MaterialForm material=\{editMaterial\}/);
 assert.doesNotMatch(materialsSource,/<MaterialForm[^>]*\bkey=/);
 assert.match(materialsSource,/const \[file,setFile\]=useState<File\|null>\(null\)/);
 // The quotation draft and its current step remain owned by the mounted modal.
 // Focus refetches only replace remote lists; they must not key or reconstruct it.
 assert.match(
  quoteCreateSource,
  /\[draft,\s*setDraft\]\s*=\s*useState<Draft>\(initial\);[\s\S]*?\[step,\s*setStep\]\s*=\s*useState\(0\)/,
 );
 assert.match(cotacaoPageSource,/searchParams\.get\('nova'\)===\'1\'&&<QuoteCreatePage\/>/);
 assert.doesNotMatch(cotacaoPageSource,/<QuoteCreatePage[^>]*\bkey=/);
 assert.doesNotMatch(quoteCreateSource,/useEffect\([^)]*setDraft/);
 assert.match(cadastroQuerySource,/loading:!ready\|\|\(!!user&&enabled&&query\.isPending\)/);
 assert.doesNotMatch(cadastroQuerySource,/loading:[^\n]*query\.isFetching/);
 // Ambiguous writes may have committed before the transport failed. They must
 // reconcile only the account that started the mutation and never hide the
 // original failure if the fallback refetch also fails.
 assert.match(cadastroQuerySource,/error\.status===409\|\|error\.status>=500/);
 assert.match(cadastroQuerySource,/error\.name==='TimeoutError'\|\|error\.name==='NetworkError'/);
 assert.match(cadastroQuerySource,/error instanceof TypeError/);
 assert.match(cadastroQuerySource,/Promise\.allSettled\(jobs\)/);
 assert.match(cadastroQuerySource,/activeUserIdRef\.current!==context\.actorId/);
 assert.match(cadastroQuerySource,/queryClient\.invalidateQueries\(\{queryKey:billingKeys\.resource\(actorId,key\)\}\)/);
 assert.match(atrHookSource,/useCadastroMutation\('atr',[\s\S]*?,\['contracts'\]\)/);
 assert.match(settingsHookSource,/useCadastroMutation<[\s\S]*?>\('settings',persistSettings,\['profile','users','planning'\]\)/);
 assert.match(culturesHookSource,/useCadastroMutation\('cultures',persistCulture,\['cultural-practices','planning'\]\)/);
 assert.match(practicesHookSource,/useCadastroMutation\('cultural-practices',[\s\S]*?,\['planning'\]\)/);
 assert.match(practicesHookSource,/useCadastroMutation\('cultural-practices',deletePractice,\['planning'\]\)/);
 assert.match(practicesHookSource,/useCadastroMutation\('cultural-practices',bootstrapSugarcaneManagement,\['cultures','planning'\]\)/);
 console.log('Passed: related realtime invalidation, profile/watermark aliases, parameter keys, account isolation and cancellation of stale account reads.');
}finally{client.clear();}
