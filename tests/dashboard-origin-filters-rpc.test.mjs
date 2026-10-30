import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('dashboard origin, client and contract filters combine on the server without reallocating load cents or hiding filter options',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async payload=>(await db.query("SELECT public.billing_rpc('summary','dashboard',$1::jsonb) result",[JSON.stringify(payload)])).rows[0].result;
 const deny=(payload,code)=>assert.rejects(()=>rpc(payload),error=>error.code===code);
 const byId=(rows,id)=>rows.find(row=>row.id===id);
 try{
  await db.exec('RESET ROLE');
  const insert=async(sql,args)=>(await db.query(sql,args)).rows[0].id;
  const farm=async(name,owner=ids.owner)=>insert("INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,$2,100,'Capela','SE') RETURNING id",[owner,name]);
  const plot=async(farmId,name,owner=ids.owner)=>insert('INSERT INTO public.billing_farm_plots(owner_id,farm_id,name,area_ha) VALUES($1,$2,$3,10) RETURNING id',[owner,farmId,name]);
  let partnerSequence=1;
  const partner=async(name)=>insert('INSERT INTO public.billing_clients(owner_id,legal_name,cnpj) VALUES($1,$2,$3) RETURNING id',[ids.owner,name,String(partnerSequence++).padStart(14,'0')]);
  const kind=await insert("INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Origem dos filtros','[]') RETURNING id",[ids.owner]);
  const contract=async(clientId,company=ids.company,status='Ativo')=>insert("INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Contrato filtro',$2,$3,$4,'Origem dos filtros','[]',$5,'2025-01-01',1000) RETURNING id",[ids.owner,company,clientId,kind,status]);
  const load=async(contractId,farmId,plotId,date,volume,atr,method=null)=>insert('INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,plot_id,loaded_at,volume,atr,harvest_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[ids.owner,contractId,farmId,plotId,date,volume,atr,method]);
  const farmA=await farm('Fazenda principal'),farmB=await farm('Outra origem'),siblingFarm=await farm('Fazenda somente filial'),otherFarm=await farm('Fazenda de outra conta',ids.otherOwner);
  const a1=await plot(farmA,'Talhão 01'),a2=await plot(farmA,'Talhão 02'),a3=await plot(farmA,'Talhão sem movimento'),b1=await plot(farmB,'Talhão 01'),siblingPlot=await plot(siblingFarm,'Talhão filial'),otherPlot=await plot(otherFarm,'Talhão privado',ids.otherOwner);
  const secondPartner=await partner('Segundo fornecedor'),siblingPartner=await partner('Fornecedor somente filial');
  const a=await contract(ids.partner),b=await contract(secondPartner,ids.company,'Concluído'),sibling=await contract(siblingPartner,ids.siblingCompany);
  const idleContract=await contract(secondPartner);
  await load(a,farmA,a1,'2026-10-01','1.111','100','1');
  const secondLoad=await load(a,farmA,a2,'2026-10-02','2.222','120','2');
  await load(a,farmB,b1,'2026-10-03','3.333','140');
  await load(a,farmA,null,'2026-10-05','4.444','160','1');
  await load(a,farmA,a1,'2026-09-15','4.444','100','1');
  await load(b,farmA,a1,'2026-10-04','10','200','2');
  await load(sibling,siblingFarm,siblingPlot,'2026-10-02','999','999','2');
  const catalogPartners=[ids.partner,secondPartner],catalogFarms=[farmA,farmB];
  // All these origins belong to the company, but have no current or comparison
  // movement. A chart's top rows cannot serve as the filter catalog.
  for(let index=0;index<10;index++){
   const client=await partner(`Fornecedor catálogo ${index}`),origin=await farm(`Fazenda catálogo ${index}`),field=await plot(origin,'Talhão catálogo');
   catalogPartners.push(client);catalogFarms.push(origin);
   await load(await contract(client),origin,field,'2025-01-01','1','100');
  }
  for(const month of [9,10])await db.query('INSERT INTO public.billing_atr_records(owner_id,year,month,monthly_gross_value,monthly_net_value,accumulated_gross_value,accumulated_net_value) VALUES($1,2026,$2,1.234567,1.234567,1.234567,1.234567)',[ids.owner,month]);
  await db.query("INSERT INTO public.billing_contract_discounts(owner_id,contract_id,request_id,title,rate_per_ton,months) VALUES($1,$2,gen_random_uuid(),'Precisão original',0.123456,ARRAY['2026-10-01'::date])",[ids.owner,a]);
  await db.query("INSERT INTO public.billing_contract_payments(owner_id,contract_id,request_id,kind,received_at,reference_month,amount) VALUES($1,$2,gen_random_uuid(),'receipt','2026-10-02','2026-10-01',100.13),($1,$3,gen_random_uuid(),'receipt','2026-10-04','2026-10-01',20.27)",[ids.owner,a,b]);
  const original=(await db.query('SELECT billing_private.decimal_text(f.gross_amount) gross,billing_private.decimal_text(f.discount_amount) discount,billing_private.decimal_text(f.net_amount) net FROM public.billing_contracts c CROSS JOIN LATERAL billing_private.contract_load_financials(c) f WHERE c.id=$1 AND f.load_id=$2',[a,secondLoad])).rows[0];
  assert.deepEqual(original,{gross:'329.19',discount:'0.27',net:'328.92'});
  await setActor();
  const scope={companyId:ids.company,from:'2026-10-01',to:'2026-10-31'};
  const all=await rpc(scope);
  assert.equal(all.totals.loadedVolume,'21.11');assert.equal(all.totals.loadCount,5);
  assert.equal(all.totals.receivedAmount,'120.4');
  const supplied=await rpc({...scope,partnerId:ids.partner});
  assert.equal(supplied.totals.loadedVolume,'11.11');assert.equal(supplied.totals.receivedAmount,'100.13');
  assert.equal(supplied.contracts.length,1);assert.equal(supplied.contracts[0].id,a);
  assert.equal(supplied.dimensions.partners.length,1);assert.equal(supplied.dimensions.partners[0].id,ids.partner);
  assert.equal(supplied.filters.partnerId,ids.partner);

  const origin=await rpc({...scope,partnerId:ids.partner,farmId:farmA});
  assert.equal(origin.totals.loadedVolume,'7.777','Farm selection includes the unplotted load');
  assert.equal(origin.totals.loadCount,3);assert.equal(origin.totals.plotCount,2);assert.equal(origin.totals.farmCount,1);
  assert.equal(origin.totals.grossAmount,'1344.18');assert.equal(origin.totals.discountAmount,'0.96');assert.equal(origin.totals.netAmount,'1343.22');
  assert.equal(origin.operationalTotals.loadedVolume,'7.777');assert.equal(origin.operationalTotals.averageAtr,'140');
  assert.equal(origin.months[0].loadedVolume,'7.777');assert.equal(origin.monthlyOperations[0].loadedVolume,'7.777');
  assert.equal(origin.farms.length,1);assert.equal(origin.farms[0].id,farmA);assert.equal(origin.farmPerformance.length,1);
  assert.deepEqual(origin.plotPerformance.map(row=>row.id).sort(),[a1,a2].sort());
  assert.equal(origin.dimensions.partners[0].loadedVolume,'7.777');assert.equal(origin.dimensions.contractTypes[0].loadedVolume,'7.777');
  assert.equal(byId(origin.contracts,a).loadedVolume,'7.777');assert.equal(byId(origin.contractPerformance,a).periodLoadedVolume,'7.777');
  assert.equal(origin.harvestMethods.find(row=>row.code==='1').loadCount,0);assert.equal(origin.harvestMethods.find(row=>row.code==='2').loadCount,0);assert.equal(origin.harvestMethods.find(row=>row.code==='unknown').loadedVolume,'7.777');
  assert.equal(origin.comparison.loadedVolume,'4.444','The comparison period receives the same origin selection');
  assert.equal(origin.dailyProductivity.productionDayCount,3);assert.equal(origin.dailyProductivity.averageLoadedVolume,'2.592');
  assert.equal(origin.financialGroupings.week[0].loadedVolume,'3.333');

  const selected=await rpc({...scope,partnerId:ids.partner,farmId:farmA,plotId:a2});
  assert.equal(selected.totals.loadedVolume,'2.222');assert.equal(selected.totals.loadCount,1);assert.equal(selected.totals.plotCount,1);
  assert.equal(selected.totals.grossAmount,original.gross,'Origin filters retain the contract-level cumulative cent allocation');
  assert.equal(selected.totals.discountAmount,original.discount);assert.equal(selected.totals.netAmount,original.net);
  assert.equal(selected.averageGrossPricePerTon,'148.15');assert.equal(selected.operationalTotals.averageAtr,'120');
  assert.equal(selected.monthlyOperations[0].loadedVolume,'2.222');assert.equal(selected.farms[0].loadedVolume,'2.222');
  assert.equal(selected.plotPerformance.length,1);assert.equal(selected.plotPerformance[0].id,a2);
  assert.equal(selected.dimensions.partners[0].loadedVolume,'2.222');assert.equal(selected.harvestMethods.find(row=>row.code==='1').loadCount,0);
  assert.equal(selected.harvestMethods.find(row=>row.code==='unknown').loadedVolume,'2.222');
  assert.equal(selected.comparison.loadedVolume,'0');assert.equal(selected.dailyProductivity.averageLoadedVolume,'2.222');
  assert.equal(selected.financialTimeline.find(row=>row.date==='2026-10-02').grossAmount,original.gross);
  assert.equal(selected.financialGroupings.week[0].loadedVolume,'2.222');assert.equal(selected.financialGroupings.fortnight[0].loadedVolume,'2.222');
  assert.equal(selected.filters.farmId,farmA);assert.equal(selected.filters.plotId,a2);
  assert.equal(selected.filters.cashScope,'contract');assert.equal(selected.totals.receivedAmount,'100.13','Cash remains attached to the selected contracts without an invented origin allocation');
  const day=await rpc({...scope,from:'2026-10-02',to:'2026-10-02',partnerId:ids.partner,farmId:farmA,plotId:a2,contractId:a,status:'Ativo'});
  assert.equal(day.totals.grossAmount,original.gross);assert.equal(day.totals.netAmount,original.net);assert.equal(day.totals.loadedVolume,'2.222');
  const completed=await rpc({...scope,farmId:farmA,plotId:a1,status:'Concluído'});
  assert.equal(completed.contracts.length,1);assert.equal(completed.contracts[0].id,b);assert.equal(completed.totals.loadedVolume,'10');
  const noMovement=await rpc({...scope,from:'2026-10-29',to:'2026-10-29',partnerId:ids.partner,farmId:farmA,plotId:a2});
  assert.equal(noMovement.totals.loadedVolume,'0');assert.equal(noMovement.totals.loadCount,0);assert.deepEqual(noMovement.plotPerformance,[]);
  assert.deepEqual(noMovement.filterOptions,all.filterOptions,'Changing dates or selecting an origin must not collapse the catalog');
  assert.deepEqual(selected.filterOptions,all.filterOptions,'Supplier selection also preserves every option');
  assert.deepEqual(all.filterOptions.partners.map(row=>row.id).sort(),catalogPartners.sort());
  assert.equal(byId(all.filterOptions.contracts,a).clientId,ids.partner);assert.equal(byId(all.filterOptions.contracts,b).clientId,secondPartner);
  assert.equal(byId(all.filterOptions.contracts,idleContract).clientId,secondPartner,'The client contract picker includes contracts without movement');
  const idleContractResult=await rpc({...scope,partnerId:secondPartner,contractId:idleContract});
  assert.equal(idleContractResult.totals.contractCount,1);assert.equal(idleContractResult.totals.loadedVolume,'0');assert.equal(idleContractResult.totals.receivedAmount,'0');
  assert.equal(idleContractResult.filters.contractId,idleContract);assert.deepEqual(idleContractResult.filterOptions,all.filterOptions);
  assert.deepEqual(all.filterOptions.farms.map(row=>row.id).sort(),catalogFarms.sort());
  assert.ok(byId(all.filterOptions.farms,farmA).plots.some(row=>row.id===a3),'Expanding a farm includes registered plots without movement');
  assert.equal(all.filterOptions.farms.some(row=>row.id===siblingFarm||row.id===otherFarm),false);
  assert.equal(all.filterOptions.partners.some(row=>row.id===siblingPartner||row.id===ids.otherPartner),false);
  assert.equal(all.filterOptions.farms.flatMap(row=>row.plots).some(row=>row.id===otherPlot||row.id===siblingPlot),false);
  const idlePlot=await rpc({...scope,farmId:farmA,plotId:a3});assert.equal(idlePlot.totals.loadedVolume,'0');
  const noIntersection=await rpc({...scope,partnerId:secondPartner,contractId:a,farmId:farmA,plotId:a2});
  assert.equal(noIntersection.totals.loadedVolume,'0');assert.equal(noIntersection.totals.receivedAmount,'0');assert.deepEqual(noIntersection.contracts,[]);
  assert.deepEqual(noIntersection.filterOptions,all.filterOptions,'Individually authorized selections with no intersection return an empty result, retaining the catalog');
  await db.exec('RESET ROLE');
  await db.query('UPDATE public.billing_contract_loads SET atr=NULL WHERE contract_id=$1 AND plot_id=$2',[a,b1]);
  await setActor();
  const pendingSupplier=await rpc({...scope,partnerId:ids.partner});assert.equal(pendingSupplier.totals.billingPending,true);assert.equal(pendingSupplier.totals.grossAmount,'');
  const pricedPlot=await rpc({...scope,partnerId:ids.partner,farmId:farmA,plotId:a2});
  assert.equal(pricedPlot.totals.billingPending,false);assert.equal(pricedPlot.totals.grossAmount,original.gross);assert.equal(pricedPlot.totals.netAmount,original.net);
  assert.equal(pricedPlot.operationalTotals.averageAtr,'120');assert.equal(pricedPlot.dimensions.partners[0].billingPending,false);

  for(const field of ['partnerId','farmId','plotId']){
   await deny({...scope,[field]:'not-a-uuid'},'22023');
   for(const invalid of [null,1,{},[]])await deny({...scope,[field]:invalid},'22023');
  }
  await deny({...scope,farmId:farmB,plotId:a1},'42501');await deny({...scope,plotId:a1},'22023');
  await deny({...scope,partnerId:siblingPartner},'42501');await deny({...scope,partnerId:ids.otherPartner},'42501');
  await deny({...scope,farmId:otherFarm},'42501');await deny({...scope,farmId:farmA,plotId:otherPlot},'42501');
  await deny({...scope,farmId:siblingFarm},'42501');
  await deny({...scope,contractId:sibling},'42501');await deny({...scope,ownerId:ids.otherOwner},'22023');
  await deny({...scope,to:'2026-09-01'},'22023');
  await assert.rejects(()=>db.query('UPDATE public.billing_contract_loads SET volume=0.001 WHERE id=$1',[secondLoad]),error=>error.code==='42501');
  await setActor(ids.otherOwner);
  await deny(scope,'22023');
  const privateScope={...scope,companyId:ids.otherCompany},other=await rpc(privateScope);
  assert.deepEqual(other.filterOptions.partners,[]);assert.deepEqual(other.filterOptions.farms,[]);
  assert.equal(other.totals.loadedVolume,'0');
  await deny({...privateScope,farmId:farmA},'42501');await deny({...privateScope,partnerId:ids.partner},'42501');
  await setActor(ids.reader);await deny(scope,'42501');
  await setActor(null);await deny(scope,'28000');
 }finally{await db.close();}
});
