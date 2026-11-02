import assert from 'node:assert/strict';
import test from 'node:test';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

const call=(db,resource,action,payload={})=>db.query('SELECT public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)]).then(result=>result.rows[0].result);
const rejectsCode=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('granular employee/overtime access works without sibling modules, administration or direct DML',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 try{
  await db.exec('RESET ROLE');
  await db.query(`UPDATE public.billing_access_profiles SET permissions=ARRAY['employees.read','employees.write','overtime.read','overtime.write'] WHERE id=$1`,[ids.readerProfile]);
  await setActor(ids.reader);
  const context=await call(db,'permissions','get');
  assert.equal(context.isOwner,false);
  assert.deepEqual(context.permissions,['employees.read','employees.write','overtime.read','overtime.write']);
  assert.equal(context.companies.length,2);
  assert.deepEqual(Object.keys(context.companies[0]).sort(),['id','isPrimary','name']);
  const employee=(await call(db,'employees','save',{fullName:'Lucas Silva',registrationNumber:'1',jobTitle:'Motorista'})).employee;
  const options=await call(db,'overtime','options',{companyId:ids.company});
  assert.equal(options.canManage,true);assert.equal(options.canRegisterEmployees,true);
  assert.equal(options.employees[0].id,employee.id);
  const report=(await call(db,'overtime','create',{companyId:ids.company,dateFrom:'2026-10-26',dateTo:'2026-11-25'})).report;
  assert.equal(report.referenceMonth,'2026-11');
  const brand=await call(db,'overtime','document-brand',{companyId:ids.company});
  assert.equal(brand.company.id,ids.company);assert.equal(brand.issuer.id,ids.reader);
  assert.deepEqual(Object.keys(brand).sort(),['company','header','issuer','watermark']);
  await rejectsCode(call(db,'overtime','document-brand',{companyId:ids.otherCompany}),'22023');
  for(const resource of ['clients','service-providers','materials','quotations','purchase-orders','purchase-requests','companies','watermarks','report-headers','document-templates','signatures','documentation','contracts','agenda','reports','summary','home','planning','import-profiles','import-documents','users','access-profiles']){
   await rejectsCode(call(db,resource,resource==='home'?'get':'list'),'42501');
  }
  assert.equal((await db.query('SELECT id FROM public.billing_employees')).rows.length,1);
  assert.equal((await db.query('SELECT id FROM public.billing_overtime_reports')).rows.length,1);
  assert.deepEqual((await db.query('SELECT id FROM public.billing_access_profiles')).rows.map(row=>row.id),[ids.readerProfile],'Only the actor own profile remains visible for permission invalidation');
  for(const table of ['billing_clients','billing_companies','billing_service_providers','billing_report_headers','billing_watermarks']){
   assert.equal((await db.query(`SELECT * FROM public.${table}`)).rows.length,0,table+' direct read is scoped');
  }
  await rejectsCode(db.query(`INSERT INTO public.billing_employees(owner_id,full_name,registration_number) VALUES($1,'Direct','2')`,[ids.owner]),'42501');
  for(const fn of ['employees_dispatch(text,jsonb)','overtime_dispatch(text,jsonb)','agenda_projection(text,jsonb)','summary_projection(text,jsonb)']){
   const allowed=(await db.query('SELECT has_function_privilege(current_user,$1,\'EXECUTE\') ok',['billing_private.'+fn])).rows[0].ok;
   assert.equal(allowed,false,fn+' cannot bypass public gate');
  }
  await rejectsCode(db.query(`SELECT billing_private.dispatch('clients','list','{}'::jsonb)`),'42501');
  await rejectsCode(db.query(`SELECT billing_private.dispatch('settings','save',$1::jsonb)`,[JSON.stringify({name:'Restrito',company:'Alteração indevida',compact:false})]),'42501');
  await rejectsCode(db.query(`SELECT billing_private.dispatch('profile','save',$1::jsonb)`,[JSON.stringify({name:'Restrito',company:'Alteração indevida',compact:false})]),'42501');
  await rejectsCode(db.query(`SELECT billing_private.quotations_dispatch('quotations','list','{}'::jsonb)`),'42501');
  await rejectsCode(db.query(`SELECT billing_private.users_dispatch('list','{}'::jsonb)`),'42501');
  await setActor(ids.otherOwner);
  assert.equal((await db.query('SELECT id FROM public.billing_employees')).rows.length,0);
  await setActor(null);await rejectsCode(call(db,'permissions','get'),'28000');
 }finally{await db.close();}
});

test('granular readers cannot mutate, legacy profiles expand without escalating sibling permissions',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 try{
  const profiles=await call(db,'access-profiles','save',{name:'Funcionários e horas',description:'Restrito',permissions:['employees.read','employees.write','overtime.read','overtime.write']});
  assert.deepEqual(profiles.profile.permissions,['employees.read','employees.write','overtime.read','overtime.write']);
  await rejectsCode(call(db,'access-profiles','save',{name:'Inválido',description:'',permissions:['employees.write']}),'22023');
  await rejectsCode(call(db,'access-profiles','save',{name:'Inválido',description:'',permissions:['employees.read','users.root']}),'22023');
  await rejectsCode(call(db,'access-profiles','save',{name:'Inválido',description:'',permissions:['employees.read','employees.read']}),'22023');
  await db.exec('RESET ROLE');
  await db.query(`UPDATE public.billing_access_profiles SET permissions=ARRAY['employees.read','overtime.read'] WHERE id=$1`,[ids.readerProfile]);
  await setActor(ids.reader);
  assert.equal((await call(db,'employees','list')).canManage,false);
  assert.equal((await call(db,'overtime','options',{companyId:ids.company})).canManage,false);
  assert.equal((await call(db,'overtime','options',{companyId:ids.company})).canRegisterEmployees,false);
  await rejectsCode(call(db,'employees','save',{fullName:'Lucas',registrationNumber:'1'}),'42501');
  await rejectsCode(call(db,'overtime','create',{companyId:ids.company,dateFrom:'2026-10-26',dateTo:'2026-11-25',referenceMonth:'2026-10',sector:''}),'42501');
  await rejectsCode(call(db,'users','link-existing',{email:'new@example.invalid',accessProfileId:ids.readerProfile}),'42501');
  await db.exec('RESET ROLE');
  await db.query(`UPDATE public.billing_access_profiles SET permissions=ARRAY['requests.read'] WHERE id=$1`,[ids.readerProfile]);
  await setActor(ids.reader);
  const permissions=(await call(db,'permissions','get')).permissions;
  assert.deepEqual(permissions,['overtime.read','service-requests.read']);
  await rejectsCode(call(db,'employees','list'),'42501');
  assert.equal((await call(db,'overtime','options',{companyId:ids.company})).canManage,false);
  await db.exec('RESET ROLE');
  await db.query(`UPDATE public.billing_access_profiles SET permissions=ARRAY['registrations.read'] WHERE id=$1`,[ids.readerProfile]);
  await setActor(ids.reader);
  const registry=(await call(db,'permissions','get')).permissions;
  assert.ok(registry.includes('employees.read')&&registry.includes('clients.read'));
  assert.ok(!registry.some(p=>p.startsWith('overtime.')||p.startsWith('service-requests.')||p.endsWith('.write')));
  assert.equal((await call(db,'clients','list')).clients.length,1);
  await rejectsCode(call(db,'overtime','options',{companyId:ids.company}),'42501');
  await rejectsCode(call(db,'access-profiles','save',{name:'Escalação',description:'',permissions:['users.manage']}),'42501');
 }finally{await db.close();}
});

test('existing Auth account can be linked only by workspace owner without mail, password or email confirmation changes',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const target='10000000-0000-4000-8000-000000000041';
 try{
  await db.exec('RESET ROLE');
  await db.query(`INSERT INTO auth.users(id,email,encrypted_password) VALUES($1,'new@example.invalid','unchanged-hash')`,[target]);
  await setActor();
  const profile=(await call(db,'access-profiles','save',{name:'Funcionários e horas',description:'Restrito',permissions:['employees.read','employees.write','overtime.read','overtime.write']})).profile;
  const linked=(await call(db,'users','link-existing',{email:' NEW@example.invalid ',accessProfileId:profile.id})).user;
  assert.equal(linked.accessProfileId,profile.id);assert.equal(linked.isOwner,false);assert.equal(linked.status,'active');
  await rejectsCode(call(db,'users','link-existing',{email:'new@example.invalid',accessProfileId:profile.id}),'23505');
  await rejectsCode(call(db,'users','link-existing',{email:ids.otherOwner+'@example.invalid',accessProfileId:profile.id}),'23505');
  await rejectsCode(call(db,'users','link-existing',{email:'new@example.invalid',accessProfileId:ids.otherOwner}),'22023');
  await db.exec('RESET ROLE');
  const user=(await db.query('SELECT email_confirmed_at,encrypted_password FROM auth.users WHERE id=$1',[target])).rows[0];
  assert.equal(user.email_confirmed_at,null);assert.equal(user.encrypted_password,'unchanged-hash');
  assert.equal((await db.query('SELECT count(*)::int count FROM public.billing_invitations')).rows[0].count,0);
  assert.equal((await db.query('SELECT owner_id FROM public.billing_memberships WHERE user_id=$1',[target])).rows[0].owner_id,ids.owner);
  await setActor(target);
  assert.equal((await call(db,'onboarding','inspect')).status,'invite');
  const permissions=await call(db,'permissions','get');assert.equal(permissions.isOwner,false);assert.deepEqual(permissions.permissions,profile.permissions);
  await rejectsCode(call(db,'companies','list'),'42501');
  await rejectsCode(call(db,'users','link-existing',{email:'missing@example.invalid',accessProfileId:profile.id}),'42501');
 }finally{await db.close();}
});


test('first authenticated permission request provisions a fresh owner and immediately sees its granular access',async()=>{
 const {db,setActor}=await createCaneWeighingDb();const fresh='10000000-0000-4000-8000-000000000051';
 try{
  await db.exec('RESET ROLE');await db.query(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'fresh@example.invalid',now())`,[fresh]);
  await setActor(fresh);
  const access=await call(db,'permissions','get');assert.equal(access.isOwner,true);assert.ok(access.permissions.includes('employees.write'));assert.deepEqual(access.companies,[]);
  assert.equal((await call(db,'onboarding','inspect')).status,'ready');
 }finally{await db.close();}
});

test('each granular catalog/projection and its private files works without blanket registry access',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const use=async permissions=>{await db.exec('RESET ROLE');await db.query('UPDATE public.billing_access_profiles SET permissions=$1 WHERE id=$2',[permissions,ids.readerProfile]);await setActor(ids.reader);};
 try{
  const requester=(await call(db,'signatures','save',{name:'Solicitante',role:'requester'})).signature;
  await db.exec('RESET ROLE');
  await db.query(`INSERT INTO public.billing_document_templates(owner_id,key,name,version,layout,updated_by)
   VALUES($1,'service-request','Modelo salvo',1,billing_private.default_request_template()->'layout',$1)`,[ids.owner]);
  await use(['materials.read','materials.write']);
  const material=(await call(db,'materials','save',{name:'Filtro granular',internalCode:'GRANULAR-1',unit:'UN',application:'Trator'})).material;
  assert.equal((await call(db,'materials','get',{id:material.id})).material.id,material.id);
  const reference=(await call(db,'material-variants','save',{materialId:material.id,brand:'Marca',code:'REF-1'})).reference;
  assert.equal((await call(db,'material-variants','get',{id:reference.id})).reference.id,reference.id);
  const image=`${ids.owner}/materials/test.webp`,quoteFile=`${ids.owner}/quotations/test.pdf`,foreignImage=`${ids.otherOwner}/materials/test.webp`;
  await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['billing-material-images',image]);
  assert.equal((await db.query('SELECT name FROM storage.objects WHERE name=$1',[image])).rows.length,1);
  await rejectsCode(db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['billing-quotation-files',quoteFile]),'42501');
  await rejectsCode(db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['billing-material-images',foreignImage]),'42501');
  await db.query('UPDATE storage.objects SET name=$1 WHERE name=$2',[image.replace('test.webp','updated.webp'),image]);
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name',[image.replace('test.webp','updated.webp')])).rows.length,1);
  await use(['quotations.read','quotations.write']);
  const quote=(await call(db,'quotations','save',{title:'Cotação granular',number:'GRANULAR-1',requestDate:'2026-11-02',requesterSignatureId:requester.id,notes:'',items:[{id:'10000000-0000-4000-8000-000000000061',materialId:material.id,quantity:'2',notes:''}],providers:[]})).quote;
  assert.equal((await call(db,'quotations','get',{id:quote.id})).quote.id,quote.id);
  assert.equal((await db.query('SELECT id FROM public.billing_quotations')).rows.length,1);
  assert.equal((await db.query('SELECT id FROM public.billing_materials')).rows.length,0,'Quotation access does not grant material-table reads');
  await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['billing-quotation-files',quoteFile]);
  assert.equal((await db.query('SELECT name FROM storage.objects WHERE name=$1',[quoteFile])).rows.length,1);
  await rejectsCode(db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['billing-material-images',image]),'42501');
  assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name',[quoteFile])).rows.length,1);
  await use(['document-templates.read']);
  assert.equal((await call(db,'document-templates','list')).canManage,false);
  assert.equal((await call(db,'document-templates','get',{key:'service-request'})).template.name,'Modelo salvo');
  assert.equal((await db.query('SELECT key FROM public.billing_document_templates')).rows.length,1);
  await rejectsCode(call(db,'document-templates','save',{key:'service-request'}),'42501');
  await rejectsCode(call(db,'report-headers','get'),'42501');
  await use(['signatures.read']);
  assert.equal((await call(db,'signatures','list')).items.length,1);
  assert.equal((await call(db,'signatures','options')).canManage,false);
  assert.equal((await db.query('SELECT id FROM public.billing_signatures')).rows.length,1);
  assert.equal((await db.query('SELECT key FROM public.billing_document_templates')).rows.length,0);
  await rejectsCode(call(db,'signatures','save',{name:'Negado',role:'requester'}),'42501');
  await use(['report-headers.read','companies.read','watermarks.read']);
  assert.equal((await db.query('SELECT key FROM public.billing_document_templates')).rows.length,0,'Header configuration alone grants no template data');
  await use(['agenda.read']);
  assert.ok((await call(db,'agenda','list',{companyId:ids.company,month:'2026-11'})).days);
  await rejectsCode(call(db,'contracts','list'),'42501');
  await use(['summary.read']);
  assert.ok(await call(db,'summary','list',{companyId:ids.company,month:'2026-11'}));
  await rejectsCode(call(db,'reports','list',{companyId:ids.company,month:'2026-11',kind:'financial'}),'42501');
  await use(['reports.read']);
  assert.equal((await call(db,'reports','list',{companyId:ids.company,month:'2026-11',kind:'financial'})).kind,'financial');
  assert.equal((await call(db,'reports','list',{companyId:ids.company,month:'2026-11',kind:'farms'})).kind,'farms');
  await rejectsCode(call(db,'summary','list',{companyId:ids.company,month:'2026-11'}),'42501');
  await use(['materials.read']);
  assert.equal((await db.query('SELECT name FROM storage.objects WHERE name=$1',[image])).rows.length,0);
  await rejectsCode(db.query('INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)',['billing-material-images',image]),'42501');
  await setActor(ids.otherOwner);assert.equal((await db.query('SELECT key FROM public.billing_document_templates')).rows.length,0);
 }finally{await db.close();}
});


test('temporary-password requirement also blocks directly executable private business entrypoints',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 try{
  await db.exec('RESET ROLE');
  await db.query("UPDATE auth.users SET encrypted_password='temporary-auth-hash' WHERE id=$1",[ids.owner]);
  await db.query('SELECT billing_private.require_temporary_password_change($1)',[ids.owner]);
  await setActor();
  await rejectsCode(call(db,'permissions','get'),'42501');
  await rejectsCode(db.query("SELECT billing_private.access_profiles_dispatch('save',$1::jsonb)",[JSON.stringify({name:'Novo perfil',description:'',permissions:['employees.read']})]),'42501');
  await rejectsCode(db.query("SELECT billing_private.workspace_settings('save',$1::jsonb)",[JSON.stringify({name:'Mudou',company:'Mudou',compact:false})]),'42501');
  await rejectsCode(db.query("SELECT billing_private.ensure_actor_workspace()"),'42501');
  await db.exec('RESET ROLE');
  assert.equal((await db.query("SELECT count(*)::int n FROM public.billing_access_profiles WHERE name='Novo perfil'")).rows[0].n,0);
 }finally{await db.close();}
});
