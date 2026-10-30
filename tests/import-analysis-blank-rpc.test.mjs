import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('analysis stays blank through profile save, forged import, edits, filtered export and historical repair',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const profiles=(action,payload)=>rpc('import-profiles',action,payload);
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const analysis={key:'NUMERO_ANALISE',label:'Número análise',column:'Z',source:'pdf',sourceKey:'numeroAnalise',type:'text',required:true,defaultValue:'9999',pattern:'(8836)',mappings:{'8836':'9999'}};
 const weight={key:'PESOBRUTO',label:'Peso bruto',column:'AA',source:'pdf',sourceKey:'pesoBruto',type:'decimal',required:false,defaultValue:''};
 try{
  const input={name:'Coluna Z vazia',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields:[analysis,weight]};
  const profile=(await profiles('save',input)).profile;
  const field=profile.fields[0];
  assert.equal(field.source,'manual');assert.equal(field.sourceKey,'');assert.equal(field.defaultValue,'');assert.equal(field.required,false);assert.equal(field.pattern,'');assert.deepEqual(field.mappings,{});assert.equal(field.column,'Z');
  let document=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'analysis.pdf',sourceHash:'4'.repeat(64),entries:[{date:'2026-10-29',values:{NUMERO_ANALISE:'8836',PESOBRUTO:'37.520'},source:{numeroAnalise:'8836'},sourcePage:1,sourceLine:'Original 8836'}]})).document;
  assert.equal(document.entries[0].values.NUMERO_ANALISE,'');assert.equal(document.entries[0].source.numeroAnalise,'8836');assert.equal(document.entries[0].values.PESOBRUTO,'37.52');
  document=(await docs('save-entry',{id:document.id,entryId:document.entries[0].id,date:'2026-10-29',values:{NUMERO_ANALISE:'9999',PESOBRUTO:'37.52'},reviewed:true,expectedUpdatedAt:document.updatedAt})).document;
  assert.equal(document.entries[0].values.NUMERO_ANALISE,'');assert.equal(document.pendingCount,0);
  document=(await docs('save-bulk',{id:document.id,entryIds:[document.entries[0].id],fieldKey:'NUMERO_ANALISE',value:'1234',expectedUpdatedAt:document.updatedAt})).document;
  assert.equal(document.entries[0].values.NUMERO_ANALISE,'');
  document=(await docs('finalize',{id:document.id,expectedUpdatedAt:document.updatedAt})).document;
  for(const action of ['export','export-filtered']){
   const exported=await docs(action,{id:document.id,...(action==='export-filtered'?{expectedUpdatedAt:document.updatedAt}:{})});
   assert.equal(exported.rows[0].values.Z,'');assert.equal(exported.rows[0].values.AA,'37.52');
  }
  await setActor(ids.otherOwner);await assert.rejects(()=>docs('get',{id:document.id}),error=>error.code==='P0002');
  await setActor(null);await assert.rejects(()=>profiles('list',{}),error=>error.code==='28000');
  await setActor(ids.owner);
  await assert.rejects(()=>db.query("UPDATE public.billing_import_entry_values SET text_value='forged' WHERE entry_id=$1",[document.entries[0].id]),error=>error.code==='42501');

  // Seed a historical snapshot/value, then execute the migration's actual repair.
  await db.exec('RESET ROLE');
  await db.query("UPDATE public.billing_import_profiles SET config=jsonb_set(config,'{fields}', $1::jsonb) WHERE id=$2",[JSON.stringify([analysis,weight]),profile.id]);
  await db.query("UPDATE public.billing_import_documents SET profile_snapshot=jsonb_set(profile_snapshot,'{fields}',$1::jsonb) WHERE id=$2",[JSON.stringify([analysis,weight]),document.id]);
  await db.query("UPDATE public.billing_import_entry_values SET text_value=NULL,decimal_value=8836 WHERE entry_id=$1 AND field_key='NUMERO_ANALISE'",[document.entries[0].id]);
  const migration=await readFile(new URL('../supabase/migrations/20261030181346_import_blank_analysis_number.sql',import.meta.url),'utf8');
  await db.exec('BEGIN;'+migration.slice(migration.indexOf('UPDATE public.billing_import_profiles')));
  await setActor(ids.owner);
  const repaired=(await docs('get',{id:document.id})).document;
  assert.equal(repaired.entries[0].values.NUMERO_ANALISE,'');assert.equal(repaired.entries[0].source.numeroAnalise,'8836');assert.equal(repaired.entries[0].values.PESOBRUTO,'37.52');assert.equal(repaired.status,'finished');assert.notEqual(repaired.updatedAt,document.updatedAt);
  assert.equal(repaired.profileSnapshot.fields[0].source,'manual');assert.equal((await profiles('list',{})).profiles[0].fields[0].source,'manual');
 }finally{await db.close();}
});
