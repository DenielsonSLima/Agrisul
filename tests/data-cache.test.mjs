import assert from 'node:assert/strict';
import {QueryClient} from '@tanstack/react-query';
import {billingKeys} from '../shared/query/keys.ts';
import {realtimeResources} from '../shared/query/realtimeResources.ts';

const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
try{
 const key=(owner,resource,params={})=>[...billingKeys.resource(owner,resource),params];
 const aFarm=key('owner-a','farms');
 const aPlotOne=key('owner-a','plots',{farmId:'farm-one'});
 const aPlotTwo=key('owner-a','plots',{farmId:'farm-two'});
 const aCompanies=key('owner-a','companies');
 const aManagement=key('owner-a','cultural-practices',{cultureId:'culture-one',cultureSubtypeId:'subtype-one'});
 const aContracts=key('owner-a','contracts',{view:'detail',id:'contract-one'});
 const bFarm=key('owner-b','farms');
 const bPlots=key('owner-b','plots',{farmId:'farm-one'});
 for(const queryKey of [aFarm,aPlotOne,aPlotTwo,aCompanies,aManagement,aContracts,bFarm,bPlots])client.setQueryData(queryKey,{source:queryKey[1]});
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

 for(const resource of realtimeResources.billing_contract_loads){
  await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
 }
 assert.equal(client.getQueryState(aContracts).isInvalidated,true);

 for(const table of ['billing_contract_payments','billing_contract_discounts']){
  client.setQueryData(aContracts,{saved:true});
  for(const resource of realtimeResources[table])await client.invalidateQueries({queryKey:billingKeys.resource('owner-a',resource),refetchType:'none'});
  assert.equal(client.getQueryState(aContracts).isInvalidated,true,table+' refreshes contract balances');
 }

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
 console.log('Passed: related realtime invalidation, profile/watermark aliases, parameter keys, account isolation and cancellation of stale account reads.');
}finally{client.clear();}
