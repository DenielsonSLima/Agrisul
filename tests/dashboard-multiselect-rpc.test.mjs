import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('dashboard multi-selection intersects clients and contracts and unions complete farms with individual plots',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async payload=>(await db.query("SELECT public.billing_rpc('summary','dashboard',$1::jsonb) result",[JSON.stringify(payload)])).rows[0].result;
 const deny=(payload,code)=>assert.rejects(()=>rpc(payload),error=>error.code===code);
 const canonical=values=>[...new Set(values)].sort();
 try{
  await db.exec('RESET ROLE');
  const insert=async(sql,args)=>(await db.query(sql,args)).rows[0].id;
  const farm=async(name,owner=ids.owner)=>insert("INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,$2,100,'Capela','SE') RETURNING id",[owner,name]);
  const plot=async(farmId,name,owner=ids.owner)=>insert('INSERT INTO public.billing_farm_plots(owner_id,farm_id,name,area_ha) VALUES($1,$2,$3,10) RETURNING id',[owner,farmId,name]);
  const partner=async(name,cnpj)=>insert('INSERT INTO public.billing_clients(owner_id,legal_name,cnpj) VALUES($1,$2,$3) RETURNING id',[ids.owner,name,cnpj]);
  const secondPartner=await partner('Segundo cliente multi','11111111111111'),siblingPartner=await partner('Cliente da filial multi','22222222222222');
  const kind=await insert("INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Multisseleção','[]') RETURNING id",[ids.owner]);
  const otherKind=await insert("INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Multisseleção outra conta','[]') RETURNING id",[ids.otherOwner]);
  const otherContract=await insert("INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Contrato privado',$2,$3,$4,'Multisseleção outra conta','[]','Ativo','2026-01-01',1000) RETURNING id",[ids.otherOwner,ids.otherCompany,ids.otherPartner,otherKind]);
  const contract=async(clientId,companyId=ids.company,status='Ativo')=>insert("INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Contrato multi',$2,$3,$4,'Multisseleção','[]',$5,'2026-01-01',1000) RETURNING id",[ids.owner,companyId,clientId,kind,status]);
  const a1=await contract(ids.partner),a2=await contract(ids.partner),b1=await contract(secondPartner,ids.company,'Concluído'),sibling=await contract(siblingPartner,ids.siblingCompany);
  const farmA=await farm('Multi fazenda A'),farmB=await farm('Multi fazenda B'),siblingFarm=await farm('Multi fazenda filial'),otherFarm=await farm('Multi fazenda outra conta',ids.otherOwner);
  const pa1=await plot(farmA,'Talhão A1'),pa2=await plot(farmA,'Talhão A2'),paEmpty=await plot(farmA,'Talhão sem carga'),pb1=await plot(farmB,'Talhão B1'),pb2=await plot(farmB,'Talhão B2'),siblingPlot=await plot(siblingFarm,'Talhão filial'),otherPlot=await plot(otherFarm,'Talhão outra conta',ids.otherOwner);
  const load=async(contractId,farmId,plotId,date,volume,atr,method=null)=>insert('INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,plot_id,loaded_at,volume,atr,harvest_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[ids.owner,contractId,farmId,plotId,date,volume,atr,method]);
  await load(a1,farmA,pa1,'2026-10-01','10','100','1');await load(a1,farmA,pa2,'2026-10-02','20','120','2');
  await load(a1,farmB,pb1,'2026-10-03','30','140');await load(a1,farmB,null,'2026-10-04','5','100','1');
  await load(a2,farmB,pb2,'2026-10-05','40','160','2');await load(b1,farmA,pa1,'2026-10-06','50','180','1');
  await load(b1,farmB,pb1,'2026-10-07','60','200','2');await load(sibling,siblingFarm,siblingPlot,'2026-10-01','999','999','2');
  await load(a1,farmA,pa1,'2026-09-10','7','100','1');
  for(const month of [9,10])await db.query('INSERT INTO public.billing_atr_records(owner_id,year,month,monthly_gross_value,monthly_net_value,accumulated_gross_value,accumulated_net_value) VALUES($1,2026,$2,1.234567,1.234567,1.234567,1.234567)',[ids.owner,month]);
  for(const [id,amount] of [[a1,'1.11'],[a2,'2.22'],[b1,'3.33']])await db.query("INSERT INTO public.billing_contract_payments(owner_id,contract_id,request_id,kind,received_at,reference_month,amount) VALUES($1,$2,gen_random_uuid(),'receipt','2026-10-02','2026-10-01',$3)",[ids.owner,id,amount]);
  await setActor();
  const scope={companyId:ids.company,from:'2026-10-01',to:'2026-10-31'},all=await rpc(scope);
  assert.equal(all.totals.loadedVolume,'215');assert.equal(all.totals.loadCount,7);assert.equal(all.totals.receivedAmount,'6.66');
  const emptyArrays=await rpc({...scope,partnerIds:[],contractIds:[],farmIds:[],plotIds:[]});
  for(const key of ['totals','months','operationalTotals','monthlyOperations','farms','dimensions','harvestMethods','financialTimeline','financialGroupings','dailyProductivity','filterOptions'])assert.deepEqual(emptyArrays[key],all[key],`Empty selection preserves ${key}`);
  for(const key of ['partnerIds','contractIds','farmIds','plotIds'])assert.deepEqual(emptyArrays.filters[key],[]);

  const clients=await rpc({...scope,partnerIds:[secondPartner,ids.partner,ids.partner]});
  assert.equal(clients.totals.loadedVolume,'215');assert.equal(clients.totals.loadCount,7);assert.deepEqual(clients.filters.partnerIds,canonical([secondPartner,ids.partner]));
  const clientA=await rpc({...scope,partnerIds:[ids.partner]});assert.equal(clientA.totals.loadedVolume,'105');assert.equal(clientA.totals.receivedAmount,'3.33');
  const contracts=await rpc({...scope,contractIds:[b1,a1,a1]});assert.equal(contracts.totals.loadedVolume,'175');assert.equal(contracts.totals.contractCount,2);assert.deepEqual(contracts.filters.contractIds,canonical([b1,a1]));
  const intersected=await rpc({...scope,partnerIds:[ids.partner],contractIds:[b1,a1]});
  assert.equal(intersected.totals.loadedVolume,'65');assert.equal(intersected.contracts.length,1);assert.equal(intersected.contracts[0].id,a1);assert.equal(intersected.totals.receivedAmount,'1.11');
  const disjoint=await rpc({...scope,partnerIds:[secondPartner],contractIds:[a1,a2]});assert.equal(disjoint.totals.loadedVolume,'0');assert.deepEqual(disjoint.contracts,[]);

  const farms=await rpc({...scope,farmIds:[farmB,farmA,farmA]});assert.equal(farms.totals.loadedVolume,'215');assert.equal(farms.totals.loadCount,7);assert.deepEqual(farms.filters.farmIds,canonical([farmB,farmA]));
  const fullFarm=await rpc({...scope,farmIds:[farmB]});assert.equal(fullFarm.totals.loadedVolume,'135','Selecting a whole farm includes loads without plots');
  const plots=await rpc({...scope,plotIds:[pb2,pa1,pa1]});
  assert.equal(plots.totals.loadedVolume,'100','Plots from different parents do not require whole-farm selection');assert.equal(plots.totals.loadCount,3);assert.deepEqual(plots.filters.plotIds,canonical([pb2,pa1]));
  assert.deepEqual(plots.plotPerformance.map(row=>row.id).sort(),[pa1,pb2].sort());assert.equal(plots.operationalTotals.averageAtr,'164');
  const union=await rpc({...scope,farmIds:[farmA],plotIds:[pb1]});assert.equal(union.totals.loadedVolume,'170');assert.equal(union.totals.loadCount,5);
  const noDuplicates=await rpc({...scope,farmIds:[farmA,farmA],plotIds:[pa1,pa1,pa2]});
  assert.equal(noDuplicates.totals.loadedVolume,'80','A plot included by its selected farm is counted once');assert.equal(noDuplicates.totals.loadCount,3);
  const combined=await rpc({...scope,partnerIds:[ids.partner],contractIds:[a1,a2],farmIds:[farmA],plotIds:[pb2]});
  assert.equal(combined.totals.loadedVolume,'70');assert.equal(combined.totals.loadCount,3);assert.equal(combined.totals.contractCount,2);
  assert.equal(combined.operationalTotals.loadedVolume,'70');assert.equal(combined.monthlyOperations[0].loadedVolume,'70');assert.equal(combined.months[0].loadedVolume,'70');
  assert.equal(combined.dimensions.partners.length,1);assert.equal(combined.dimensions.partners[0].loadedVolume,'70');assert.equal(combined.dimensions.contractTypes[0].loadedVolume,'70');
  assert.equal(combined.harvestMethods.find(row=>row.code==='1').loadedVolume,'10.000');assert.equal(combined.harvestMethods.find(row=>row.code==='2').loadedVolume,'60.000');
  assert.equal(combined.comparison.loadedVolume,'7');assert.equal(combined.dailyProductivity.productionDayCount,3);
  assert.equal(combined.financialGroupings.week[0].loadedVolume,'30');assert.equal(combined.financialGroupings.week[1].loadedVolume,'40');
  assert.equal(combined.financialGroupings.fortnight[0].loadedVolume,'70');assert.equal(combined.filters.cashScope,'contract');assert.equal(combined.totals.receivedAmount,'3.33');
  assert.deepEqual(combined.filterOptions,all.filterOptions,'Combining multiple selections never removes catalog options');
  const onlySecondContract=await rpc({...scope,plotIds:[pb2]});assert.equal(onlySecondContract.totals.receivedAmount,'2.22','Cash is not proportionally allocated to selected origins');
  const idle=await rpc({...scope,plotIds:[paEmpty]});assert.equal(idle.totals.loadedVolume,'0');assert.deepEqual(idle.filters.plotIds,[paEmpty]);assert.deepEqual(idle.filterOptions,all.filterOptions);
  const status=await rpc({...scope,partnerIds:[ids.partner,secondPartner],contractIds:[a1,b1],status:'Concluído',farmIds:[farmA]});assert.equal(status.totals.loadedVolume,'50');assert.equal(status.contracts[0].id,b1);
  const day=await rpc({...scope,from:'2026-10-02',to:'2026-10-02',partnerIds:[ids.partner],contractIds:[a1],plotIds:[pa2]});assert.equal(day.totals.loadedVolume,'20');assert.equal(day.totals.loadCount,1);

  // Singular callers remain supported and are unioned with array selections.
  const legacyUnion=await rpc({...scope,partnerId:ids.partner,partnerIds:[secondPartner],contractId:a1,contractIds:[a2,b1],farmId:farmA,farmIds:[farmB]});
  assert.equal(legacyUnion.totals.loadedVolume,'215');assert.deepEqual(legacyUnion.filters.partnerIds,canonical([ids.partner,secondPartner]));assert.deepEqual(legacyUnion.filters.contractIds,canonical([a1,a2,b1]));assert.deepEqual(legacyUnion.filters.farmIds,canonical([farmA,farmB]));
  const legacyPlot=await rpc({...scope,farmId:farmA,plotId:pa1,plotIds:[pb2]});
  assert.equal(legacyPlot.totals.loadedVolume,'100','Legacy farm+plot selects the child, while additional plots union across parents');

  for(const field of ['partnerIds','contractIds','farmIds','plotIds']){
   for(const value of [null,{},true,1,'not-an-array',[null],[1],[{}],[[]],[''],['bad-id']])await deny({...scope,[field]:value},'22023');
   const good=field==='partnerIds'?ids.partner:field==='contractIds'?a1:field==='farmIds'?farmA:pa1;
   await deny({...scope,[field]:Array(201).fill(good)},'22023');
   const bounded=await rpc({...scope,[field]:Array(200).fill(good)});assert.deepEqual(bounded.filters[field],[good],'The bound permits valid repeated values and the echo deduplicates them');
  }
  for(const [field,valid,foreign] of [['partnerIds',ids.partner,ids.otherPartner],['partnerIds',ids.partner,siblingPartner],['contractIds',a1,sibling],['contractIds',a1,otherContract],['farmIds',farmA,siblingFarm],['farmIds',farmA,otherFarm],['plotIds',pa1,siblingPlot],['plotIds',pa1,otherPlot]])await deny({...scope,[field]:[valid,foreign]},'42501');
  await deny({...scope,ownerId:ids.otherOwner,partnerIds:[ids.partner]},'22023');
  await setActor(ids.otherOwner);const otherScope={...scope,companyId:ids.otherCompany},other=await rpc(otherScope);assert.equal(other.totals.loadedVolume,'0');
  assert.deepEqual(other.filterOptions.partners.map(row=>row.id),[ids.otherPartner]);assert.deepEqual(other.filterOptions.contracts.map(row=>row.id),[otherContract]);assert.deepEqual(other.filterOptions.farms,[]);
  await deny({...otherScope,partnerIds:[ids.partner]},'42501');await deny({...otherScope,contractIds:[a1]},'42501');await deny({...otherScope,farmIds:[farmA]},'42501');await deny({...otherScope,plotIds:[pa1]},'42501');
  await setActor(ids.reader);await deny({...scope,partnerIds:[ids.partner]},'42501');
  await setActor(null);await deny({...scope,partnerIds:[ids.partner]},'28000');
 }finally{await db.close();}
});
