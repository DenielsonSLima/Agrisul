import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('Import profiles: exact inactive clones, scoped defaults, revisions, historic retries and read-only isolation',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const profiles=(action,payload)=>rpc('import-profiles',action,payload);
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const denied=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 const column=i=>i<26?String.fromCharCode(65+i):'A'+String.fromCharCode(65+i-26);
 const fields=Array.from({length:46},(_,i)=>({key:`ERP_${i+1}`,label:`Campo ${i+1}`,column:column(i),source:'manual',type:['text','decimal','date'][i%3],required:false,defaultValue:['0007','12.1256','2026-10-22'][i%3],mappings:{'01':'001'},pattern:'',sourceKey:''}));
 const templateBase64=Buffer.from('PK original workbook bytes with formatting and all 46 types').toString('base64');
 const input={name:'Modelo base',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields,templateBase64,templateName:'modelo-original.xlsx'};
 const saveInput=(profile,changes={})=>({...input,id:profile.id,name:profile.name,clientId:profile.clientId,expectedUpdatedAt:profile.updatedAt,...changes});
 const imported=(profile,label)=>({profileId:profile.id,clientId:ids.partner,sourceName:`${label}.pdf`,sourceHash:createHash('sha256').update(label).digest('hex'),entries:[{date:'2026-10-22',values:Object.fromEntries(fields.map(f=>[f.key,f.defaultValue])),source:{entrada:'2874',sequencia:'1'},sourcePage:1,sourceLine:'Fonte preservada'}]});
 const find=async id=>(await profiles('list')).profiles.find(p=>p.id===id);
 try{
  let source=(await profiles('save',input)).profile;
  assert.equal(source.active,true);assert.equal(source.isDefault,false);assert.equal(source.clonedFromId,null);
  source=(await profiles('set-default',{id:source.id,expectedUpdatedAt:source.updatedAt})).profile;
  assert.equal(source.isDefault,true);
  const historyInput=imported(source,'historical');
  const original=(await docs('import',historyInput)).document;
  const sourceRevision=source.updatedAt;
  let clone=(await profiles('clone',{id:source.id,expectedUpdatedAt:source.updatedAt,name:'Cópia exata'})).profile;
  assert.notEqual(clone.id,source.id);assert.equal(clone.active,false);assert.equal(clone.isDefault,false);assert.equal(clone.clonedFromId,source.id);assert.equal(clone.clientId,source.clientId);
  assert.equal(clone.fields.length,46);assert.deepEqual(clone.fields,source.fields);assert.equal(clone.templateBase64,templateBase64);assert.equal(clone.templateName,input.templateName);assert.equal(clone.parser,source.parser);assert.equal(clone.startRow,source.startRow);assert.equal(clone.sheetName,source.sheetName);
  assert.equal((await find(source.id)).updatedAt,sourceRevision,'Cloning never changes the source profile');
  await assert.rejects(()=>profiles('clone',{id:source.id,expectedUpdatedAt:source.updatedAt,name:source.name}),e=>e.code==='23505'&&e.message==='Já existe um modelo com esse nome ou um padrão para esse cliente.');
  assert.equal((await profiles('list')).profiles.length,2,'Inactive profiles remain visible in configuration');
  await denied(()=>profiles('set-default',{id:clone.id,expectedUpdatedAt:clone.updatedAt}),'23514');
  await denied(()=>docs('import',imported(clone,'inactive-copy')),'23514');
  await denied(()=>profiles('clone',{id:source.id,expectedUpdatedAt:source.updatedAt,name:'Cliente estrangeiro',clientId:ids.otherPartner}),'22023');
  await denied(()=>profiles('clone',{id:source.id,expectedUpdatedAt:source.updatedAt,name:'Forjado',ownerId:ids.otherOwner}),'22023');
  const initialCloneRevision=clone.updatedAt;
  clone=(await profiles('set-active',{id:clone.id,expectedUpdatedAt:clone.updatedAt,active:true})).profile;
  await denied(()=>profiles('set-active',{id:clone.id,expectedUpdatedAt:initialCloneRevision,active:false}),'PT409');
  clone=(await profiles('set-default',{id:clone.id,expectedUpdatedAt:clone.updatedAt})).profile;
  source=await find(source.id);assert.equal(source.isDefault,false);assert.equal(clone.isDefault,true);
  await denied(()=>profiles('clone',{id:source.id,expectedUpdatedAt:sourceRevision,name:'Revisão antiga'}),'PT409');
  clone=(await profiles('save',saveInput(clone,{name:'Cópia editada'}))).profile;
  assert.equal(clone.active,true);assert.equal(clone.isDefault,true);assert.equal(clone.clonedFromId,source.id,'Saving fields preserves lifecycle metadata');
  await denied(()=>profiles('save',{...saveInput(clone),active:false}),'22023');
  clone=(await profiles('set-active',{id:clone.id,expectedUpdatedAt:clone.updatedAt,active:false})).profile;
  assert.equal(clone.isDefault,false);assert.equal(clone.active,false);
  source=(await profiles('set-active',{id:source.id,expectedUpdatedAt:source.updatedAt,active:false})).profile;
  assert.deepEqual((await docs('get',{id:original.id})).document.profileSnapshot,original.profileSnapshot,'Lifecycle changes leave historical snapshots untouched');
  const retry=await docs('import',historyInput);assert.equal(retry.created,false);assert.equal(retry.document.id,original.id);
  await denied(()=>docs('import',imported(source,'new-inactive-file')),'23514');
  const inactiveOriginCopy=(await profiles('clone',{id:source.id,expectedUpdatedAt:source.updatedAt,name:'Cópia de origem inativa',clientId:null})).profile;
  assert.equal(inactiveOriginCopy.active,false);assert.equal(inactiveOriginCopy.clientId,null);assert.deepEqual(inactiveOriginCopy.fields,fields);

  let genericA=(await profiles('save',{...input,name:'Genérico A',clientId:null})).profile;
  let genericB=(await profiles('save',{...input,name:'Genérico B',clientId:null})).profile;
  genericA=(await profiles('set-default',{id:genericA.id,expectedUpdatedAt:genericA.updatedAt})).profile;
  genericB=(await profiles('set-default',{id:genericB.id,expectedUpdatedAt:genericB.updatedAt})).profile;
  assert.equal((await find(genericA.id)).isDefault,false);assert.equal(genericB.isDefault,true,'Only one generic default may exist');
  source=(await profiles('set-active',{id:source.id,expectedUpdatedAt:source.updatedAt,active:true})).profile;
  source=(await profiles('set-default',{id:source.id,expectedUpdatedAt:source.updatedAt})).profile;
  assert.equal((await find(genericB.id)).isDefault,true,'A client default and generic default coexist');
  await denied(()=>profiles('save',saveInput(source,{clientId:null})),'23505');
  assert.equal((await find(source.id)).clientId,ids.partner,'Moving a default into an occupied scope rolls back the save');
  assert.equal((await find(source.id)).isDefault,true);

  await db.exec('RESET ROLE');
  await denied(()=>db.query('UPDATE public.billing_import_profiles SET is_default=true WHERE owner_id=$1 AND id=$2',[ids.owner,genericA.id]),'23505');
  await denied(()=>db.query('UPDATE public.billing_import_profiles SET is_default=true WHERE owner_id=$1 AND id=$2',[ids.owner,clone.id]),'23514');
  await db.query("UPDATE public.billing_access_profiles SET permissions=array_append(permissions,'registrations.read') WHERE owner_id=$1 AND id=$2",[ids.owner,ids.readerProfile]);
  await setActor(ids.reader);
  assert.equal((await profiles('list')).canManage,false);
  for(const [action,payload] of [['clone',{name:'Leitor'}],['set-active',{active:false}],['set-default',{}]]){
   await denied(()=>profiles(action,{id:source.id,expectedUpdatedAt:source.updatedAt,...payload}),'42501');
  }
  await denied(()=>db.query('UPDATE public.billing_import_profiles SET active=false WHERE id=$1',[source.id]),'42501');
  await setActor(ids.otherOwner);assert.equal((await profiles('list')).profiles.length,0);
  for(const [action,payload] of [['clone',{name:'Outro proprietário'}],['set-active',{active:false}],['set-default',{}]]){
   await denied(()=>profiles(action,{id:source.id,expectedUpdatedAt:source.updatedAt,...payload}),'P0002');
  }
  await setActor(null);
  await denied(()=>profiles('clone',{id:source.id,expectedUpdatedAt:source.updatedAt}),'28000');
 }finally{await db.close();}
});
