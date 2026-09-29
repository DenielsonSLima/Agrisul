import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {PROJECT_REF,callMcp,getMcpCredentials} from './supabase-mcp.mjs';

const EXPECTED_PROJECT='rbuscpwntzpyqsuycqmv';
const args=Object.fromEntries(process.argv.slice(2).map((value,index,all)=>value.startsWith('--')?[value.slice(2),all[index+1]??'']:null).filter(Boolean));
const sourceOwner=args.source??'';
const targetEmail=(args.email??'').trim().toLowerCase();
const targetName=(args.name??'').trim();
const execute=args.execute==='yes';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if(PROJECT_REF!==EXPECTED_PROJECT)throw new Error(`Projeto Supabase incorreto: ${PROJECT_REF}`);
if(!execute||!uuid.test(sourceOwner)||!/^\S+@\S+\.\S+$/.test(targetEmail)||targetName.length<2){
  throw new Error('Uso: node scripts/provision-workspace-clone.mjs --source UUID --email EMAIL --name NOME --execute yes');
}

const {authorization}=getMcpCredentials();
const url=`https://${PROJECT_REF}.supabase.co`;
const keyResponse=await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`,{headers:{Authorization:authorization}});
assert.equal(keyResponse.status,200,'A Management API precisa autorizar o projeto correto.');
const keys=await keyResponse.json();
const publicKey=keys.find(key=>key.type==='publishable')?.api_key;
const adminKey=keys.find(key=>key.type==='secret')?.api_key??keys.find(key=>key.name==='service_role')?.api_key;
assert.ok(publicKey&&adminKey,'As chaves pública e administrativa precisam estar disponíveis.');

const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,adminKey,options);
const temporaryPassword=`Aa9!${randomBytes(24).toString('base64url')}`;
let targetId='';
let created=false;
const copied=[];

async function rows(table,columns='*',owner=sourceOwner){
  const {data,error}=await admin.from(table).select(columns).eq('owner_id',owner).range(0,999);
  if(error)throw new Error(`${table}: ${error.message}`);
  return data??[];
}

async function count(table,owner){
  const {count:errorCount,error}=await admin.from(table).select('*',{count:'exact',head:true}).eq('owner_id',owner);
  if(error)throw new Error(`${table}: ${error.message}`);
  return errorCount??0;
}

async function collectStorageReferences(){
  const [companies,materials,variants,watermarks]=await Promise.all([
    rows('billing_companies'),rows('billing_materials'),rows('billing_material_variants'),rows('billing_watermarks'),
  ]);
  const references=[];
  for(const company of companies)if(company.logo_key)references.push({bucket:'billing-company-logos',path:company.logo_key});
  for(const material of materials)if(material.image_key)references.push({bucket:'billing-material-images',path:material.image_key});
  for(const variant of variants)if(variant.image_key)references.push({bucket:'billing-material-images',path:variant.image_key});
  for(const watermark of watermarks){
    for(const [key,value] of Object.entries(watermark)){
      if((key==='image_key'||key.endsWith('_image_key'))&&typeof value==='string'&&value)references.push({bucket:'billing-watermarks',path:value});
    }
  }
  return [...new Map(references.map(item=>[`${item.bucket}:${item.path}`,item])).values()];
}

async function copyStorage(reference){
  if(!reference.path.startsWith(`${sourceOwner}/`))throw new Error(`Caminho fora do espaço de origem: ${reference.bucket}/${reference.path}`);
  const destination=`${targetId}${reference.path.slice(sourceOwner.length)}`;
  const {error}=await admin.storage.from(reference.bucket).copy(reference.path,destination);
  if(error)throw new Error(`Falha ao copiar ${reference.bucket}/${reference.path}: ${error.message}`);
  copied.push({bucket:reference.bucket,path:destination});
}

async function cleanCopiedStorage(){
  for(const bucket of new Set(copied.map(item=>item.bucket))){
    const paths=copied.filter(item=>item.bucket===bucket).map(item=>item.path);
    if(paths.length)await admin.storage.from(bucket).remove(paths);
  }
}

const cloneTables=[
  'billing_companies','billing_clients','billing_atr_records','billing_farms','billing_farm_plots',
  'billing_contract_types','billing_cultures','billing_culture_subtypes','billing_cultural_practices',
  'billing_watermarks','billing_profiles','billing_contracts','billing_contract_loads',
  'billing_contract_payments','billing_contract_discounts','billing_planning_entries','billing_planning_goals',
  'billing_planning_goal_entries','billing_planning_goal_revisions','billing_planning_executions',
  'billing_planning_periods','billing_planning_allocations','billing_planning_allocation_practices',
  'billing_planning_history','billing_planning_harvest_plots','billing_planning_field_logs',
  'billing_planning_harvest_targets','billing_material_categories','billing_materials',
  'billing_material_variants','billing_fleet_vehicles','billing_service_providers',
  'billing_service_provider_contacts','billing_payment_methods','billing_document_templates','billing_report_headers',
];
const excludedTables=[
  'billing_quotations','billing_quotation_items','billing_quotation_providers',
  'billing_quotation_provider_values','billing_quotation_negotiations','billing_quotation_item_awards',
  'billing_purchase_orders','billing_purchase_order_items','billing_request_files','billing_signatures',
  'billing_service_requests','billing_service_request_events','billing_service_request_complements',
];

try{
  const {data:existing,error:listError}=await admin.auth.admin.listUsers({page:1,perPage:1000});
  if(listError)throw listError;
  if(existing.users.some(user=>user.email?.toLowerCase()===targetEmail))throw new Error('O e-mail de destino já existe no Supabase Auth. Nada foi alterado.');

  const storageReferences=await collectStorageReferences();
  const {data:createdUser,error:createError}=await admin.auth.admin.createUser({
    email:targetEmail,
    password:temporaryPassword,
    email_confirm:true,
    user_metadata:{display_name:targetName},
    app_metadata:{billing_clone_source:sourceOwner,billing_clone_status:'provisioning'},
  });
  if(createError)throw createError;
  targetId=createdUser.user.id;
  created=true;

  for(const reference of storageReferences)await copyStorage(reference);

  const safeName=targetName.replaceAll("'","''");
  const query=`select billing_private.clone_workspace_snapshot('${sourceOwner}'::uuid,'${targetId}'::uuid,'${safeName}'::text) as result;`;
  await callMcp('execute_sql',{query});

  for(const table of cloneTables){
    const [sourceCount,targetCount]=await Promise.all([count(table,sourceOwner),count(table,targetId)]);
    assert.equal(targetCount,sourceCount,`${table} deve manter a mesma quantidade da origem.`);
  }
  for(const table of excludedTables)assert.equal(await count(table,targetId),0,`${table} deve começar vazia.`);

  const {data:membership,error:membershipError}=await admin.from('billing_memberships').select('owner_id,user_id,is_owner,status').eq('user_id',targetId).single();
  if(membershipError)throw membershipError;
  assert.deepEqual(membership,{owner_id:targetId,user_id:targetId,is_owner:true,status:'active'});

  const {error:metadataError}=await admin.auth.admin.updateUserById(targetId,{
    app_metadata:{billing_clone_source:sourceOwner,billing_clone_status:'complete',billing_clone_completed_at:new Date().toISOString()},
  });
  if(metadataError)throw metadataError;

  const target=createClient(url,publicKey,options);
  const {error:loginError}=await target.auth.signInWithPassword({email:targetEmail,password:temporaryPassword});
  if(loginError)throw loginError;
  const {data:onboarding,error:onboardingError}=await target.rpc('billing_rpc',{p_resource:'onboarding',p_action:'inspect',p_payload:{}});
  if(onboardingError)throw onboardingError;
  assert.equal(onboarding?.status,'password','A conta deve exigir a troca da senha temporária.');
  const {data:visibleContracts,error:visibilityError}=await target.from('billing_contracts').select('id,owner_id');
  if(visibilityError)throw visibilityError;
  assert.equal(visibleContracts.length,await count('billing_contracts',targetId));
  assert.ok(visibleContracts.every(row=>row.owner_id===targetId));
  await target.auth.signOut({scope:'local'});

  console.log(JSON.stringify({
    projectRef:PROJECT_REF,
    targetEmail,
    targetUserId:targetId,
    copiedStorageObjects:copied.length,
    temporaryPassword,
    firstAccessStatus:onboarding.status,
  },null,2));
}catch(error){
  if(copied.length)await cleanCopiedStorage().catch(()=>{});
  if(created&&targetId)await admin.auth.admin.deleteUser(targetId).catch(()=>{});
  throw error;
}
