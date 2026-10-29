import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('dashboard dimensions aggregate exact server contract figures, weighted ATR and scoped volume shares',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const deny=(fn,code)=>assert.rejects(fn,error=>error.code===code);
 try{
  await db.exec('RESET ROLE');
  const insert=async(sql,args)=>(await db.query(sql,args)).rows[0].id;
  const farm=await insert(`INSERT INTO public.billing_farms(owner_id,name,area_ha,city,state) VALUES($1,'Origem dimensões',100,'Cuiabá','MT') RETURNING id`,[ids.owner]);
  const partner=await insert(`INSERT INTO public.billing_clients(owner_id,legal_name,cnpj) VALUES($1,'PINHEIRO','11111111111111') RETURNING id`,[ids.owner]);
  const kind=await insert(`INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Fornecimento atual','[]') RETURNING id`,[ids.owner]);
  const otherKind=await insert(`INSERT INTO public.billing_contract_types(owner_id,name,stages) VALUES($1,'Parceria','[]') RETURNING id`,[ids.owner]);
  const contract=async(client,type,status='Ativo',company=ids.company)=>insert(`INSERT INTO public.billing_contracts(owner_id,title,company_id,client_id,type_id,type_name,stages,status,start_date,contracted_volume) VALUES($1,'Contrato dimensões',$2,$3,$4,'Nome antigo','[]',$5,'2026-10-01',1000) RETURNING id`,[ids.owner,company,client,type,status]);
  const a=await contract(ids.partner,kind),b=await contract(ids.partner,otherKind),c=await contract(partner,kind),empty=await contract(partner,otherKind,'Concluído'),sibling=await contract(ids.partner,kind,'Ativo',ids.siblingCompany);
  const load=async(id,volume,atr,date='2026-10-22')=>insert(`INSERT INTO public.billing_contract_loads(owner_id,contract_id,farm_id,loaded_at,volume,atr) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[ids.owner,id,farm,date,volume,atr]);
  await load(a,'10','100');await load(a,'30','140');await load(b,'20',null);await load(c,'40','120');await load(sibling,'999','999');await load(a,'100','999','2026-09-01');
  await db.query(`INSERT INTO public.billing_atr_records(owner_id,year,month,monthly_gross_value,monthly_net_value,accumulated_gross_value,accumulated_net_value) VALUES($1,2026,10,1.234567,1.234567,1.234567,1.234567)`,[ids.owner]);
  await db.query(`INSERT INTO public.billing_contract_payments(owner_id,contract_id,request_id,kind,received_at,reference_month,amount) VALUES($1,$2,gen_random_uuid(),'receipt','2026-10-22','2026-10-01',100.13),($1,$3,gen_random_uuid(),'receipt','2026-10-22','2026-10-01',6000)`,[ids.owner,a,c]);
  await setActor();
  const scope={companyId:ids.company,from:'2026-10-01',to:'2026-10-31'};
  const summary=await rpc('summary','dashboard',scope);
  const byId=(rows,id)=>rows.find(row=>row.id===id);
  const taquari=byId(summary.dimensions.partners,ids.partner),pinheiro=byId(summary.dimensions.partners,partner);
  assert.equal(summary.dimensions.partners.length,2);assert.equal(summary.dimensions.contractTypes.length,2);
  assert.equal(taquari.contractCount,2);assert.equal(taquari.loadCount,3);assert.equal(taquari.loadedVolume,'60');assert.equal(taquari.sharePercent,'60');assert.equal(taquari.averageAtr,'');assert.equal(taquari.billingPending,true);assert.equal(taquari.netAmount,'');assert.equal(taquari.pendingAmount,'');assert.equal(taquari.receivedAmount,'100.13');
  assert.equal(pinheiro.contractCount,2,'Counts contracts without movement');assert.equal(pinheiro.loadCount,1);assert.equal(pinheiro.loadedVolume,'40');assert.equal(pinheiro.sharePercent,'40');assert.equal(pinheiro.averageAtr,'120');assert.equal(pinheiro.billingPending,false);
  const supply=byId(summary.dimensions.contractTypes,kind);assert.equal(supply.name,'Fornecimento atual');assert.equal(supply.contractCount,2);assert.equal(supply.loadedVolume,'80');assert.equal(supply.averageAtr,'125');assert.equal(supply.sharePercent,'80');
  assert.equal(supply.netAmount,'12345.67','Retains rounded contract financial figures with six-decimal ATR quotation');
  assert.equal(supply.receivedAmount,'6100.13');assert.equal(supply.pendingAmount,'6319.62','Credit in another contract cannot erase a contract balance');
  assert.equal(pinheiro.netAmount,byId(summary.contracts,c).netAmount);
  const selected=await rpc('summary','dashboard',{...scope,contractId:a});assert.equal(selected.dimensions.partners.length,1);assert.equal(selected.dimensions.partners[0].contractCount,1);assert.equal(selected.dimensions.partners[0].averageAtr,'130');assert.equal(selected.dimensions.partners[0].sharePercent,'100');
  const finished=await rpc('summary','dashboard',{...scope,status:'Concluído'});assert.equal(finished.dimensions.partners[0].contractCount,1);assert.equal(finished.dimensions.partners[0].loadCount,0);assert.equal(finished.dimensions.partners[0].averageAtr,'');assert.equal(finished.dimensions.partners[0].netAmount,'0');assert.equal(finished.dimensions.partners[0].sharePercent,'0');
  const noPeriod=await rpc('summary','dashboard',{...scope,from:'2026-10-23',to:'2026-10-23'});assert.equal(noPeriod.dimensions.partners.every(row=>row.loadCount===0&&row.sharePercent==='0'&&row.averageAtr===''),true);assert.equal(noPeriod.dimensions.partners.reduce((sum,row)=>sum+row.contractCount,0),4);
  const filial=await rpc('summary','dashboard',{...scope,companyId:ids.siblingCompany});assert.equal(filial.dimensions.partners.length,1);assert.equal(filial.dimensions.partners[0].loadedVolume,'999');
  await db.exec('RESET ROLE');await db.query('UPDATE public.billing_atr_records SET monthly_gross_value=NULL WHERE owner_id=$1',[ids.owner]);await setActor();
  const withoutQuote=await rpc('summary','dashboard',scope);const missingQuote=byId(withoutQuote.dimensions.contractTypes,kind);
  assert.equal(missingQuote.averageAtr,'125','Missing quotation does not hide the measured weighted ATR');assert.equal(missingQuote.billingPending,true);assert.equal(missingQuote.netAmount,'');assert.equal(missingQuote.pendingAmount,'');assert.equal(missingQuote.receivedAmount,'6100.13');
  await deny(()=>rpc('summary','dashboard',{...scope,contractId:sibling}),'42501');await deny(()=>rpc('summary','dashboard',{...scope,ownerId:ids.otherOwner}),'22023');await deny(()=>rpc('summary','dashboard',{...scope,to:'2026-09-01'}),'22023');
  await deny(()=>db.query(`SELECT billing_private.summary_dimensions($1::jsonb,$2::jsonb)`,[JSON.stringify(scope),JSON.stringify(summary)]),'42501');
  await setActor(ids.otherOwner);await deny(()=>rpc('summary','dashboard',scope),'22023');const other=await rpc('summary','dashboard',{...scope,companyId:ids.otherCompany});assert.deepEqual(other.dimensions,{partners:[],contractTypes:[]});
  await setActor(ids.reader);await deny(()=>rpc('summary','dashboard',scope),'42501');
  await setActor(null);await deny(()=>rpc('summary','dashboard',scope),'28000');
 }finally{await db.close();}
});
