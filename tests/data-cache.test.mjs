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
