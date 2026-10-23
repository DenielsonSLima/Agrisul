import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('Taquari RPC derives vehicle counts and the sequence-one equipment from original date and entry',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const profiles=(action,payload)=>rpc('import-profiles',action,payload);
 const documents=(action,payload)=>rpc('import-documents',action,payload);
 const field=(key,column,sourceKey,type='text')=>({key,column,sourceKey,label:key,type,source:sourceKey?'pdf':'manual',defaultValue:'',required:false,mappings:{}});
 const fields=[field('COD_TIPOCARGA','R','quantidadeVeiculosConjunto','decimal'),field('COD_EQUIPAMENTO_TRANSPORTE','S','equipamentoPrincipal'),field('COD_EQUIPAMENTO_COMPARTIMENTO','Y','equipamentoPrincipal'),field('COD_TERCEIRO','U',''),field('COD_ENTRADA','L',''),field('COD_FAZENDA','F','')];
 const row=(entry,sequence,equipment,date='2026-10-22',farm='1582',page=1)=>({date,
  source:{entrada:entry,sequencia:String(sequence),equipamento:equipment,dataMovimento:date,fazendaOrigem:farm,quantidadeVeiculosConjunto:'99',equipamentoPrincipal:'999'},
  values:{COD_TIPOCARGA:'99',COD_EQUIPAMENTO_TRANSPORTE:'999',COD_EQUIPAMENTO_COMPARTIMENTO:'999',COD_TERCEIRO:'77',COD_ENTRADA:'649',COD_FAZENDA:sequence===3?'5011':'5010'},
  sourcePage:page,sourceLine:`${entry} sequência ${sequence} equipamento ${equipment}`});
 const profileInput={name:'Taquari conjunto',clientId:ids.partner,parser:'taquari-equipment-v1',sheetName:'Plan1',startRow:2,fields};
 const saveImport=(label,entries,profileId)=>documents('import',{profileId,clientId:ids.partner,sourceName:`${label}.pdf`,sourceHash:createHash('sha256').update(label).digest('hex'),entries});
 const denied=(fn,message)=>assert.rejects(fn,e=>e.code==='22023'&&(!message||message.test(e.message)));
 try{
  const {profile}=await profiles('save',profileInput);
  const entries=[
   row('2874',2,'6270','2026-10-22','1582',2),row('2850',3,'233'),
   row('2874',1,'6269','2026-10-22','1582',1),row('2850',1,'186'),row('2850',2,'246'),
   row('2874',1,'500','2026-10-23'),row('2874',2,'501','2026-10-23'),row('2874',3,'502','2026-10-23'),
   row('7777',1,'800','2026-10-22','1582'),row('7777',2,'801','2026-10-22','1591'),
  ];
  let {document}=await saveImport('valid-groups',entries,profile.id);
  assert.equal(document.entryCount,10);
  for(const entry of document.entries){
   const identity=entry.source.dataMovimento+'|'+entry.source.entrada;
   const [quantity,principal]={'2026-10-22|2874':['2','6269'],'2026-10-22|2850':['3','186'],'2026-10-23|2874':['3','500'],'2026-10-22|7777':['2','800']}[identity];
   assert.equal(entry.values.COD_TIPOCARGA,quantity,'Same-farm groups can contain different vehicle counts');
   assert.equal(entry.source.quantidadeVeiculosConjunto,quantity,'The database replaces a forged derived source count');
   assert.equal(entry.source.equipamentoPrincipal,principal,'The database replaces a forged derived principal');
   assert.equal(entry.values.COD_EQUIPAMENTO_TRANSPORTE,principal);assert.equal(entry.values.COD_EQUIPAMENTO_COMPARTIMENTO,principal);
   assert.equal(entry.values.COD_TERCEIRO,'77');assert.equal(entry.values.COD_ENTRADA,'649','ERP entry numbers do not define source groups');
   assert.equal(entry.source.equipamento,entries.find(x=>x.source.entrada===entry.source.entrada&&x.source.sequencia===entry.source.sequencia&&x.date===entry.date).source.equipamento,'Raw equipment evidence is preserved');
  }
  const retry=await saveImport('valid-groups',entries,profile.id);assert.equal(retry.created,false);assert.equal(retry.document.id,document.id);
  const first=document.entries[0];
  document=(await documents('save-entry',{id:document.id,entryId:first.id,date:first.date,values:{...first.values,COD_TIPOCARGA:'8',COD_EQUIPAMENTO_TRANSPORTE:'CORREÇÃO'},reviewed:false,expectedUpdatedAt:document.updatedAt})).document;
  assert.equal(document.entries.find(e=>e.id===first.id).values.COD_TIPOCARGA,'8','Explicit later manual corrections remain available');
  document=(await documents('save-bulk',{id:document.id,entryIds:[first.id],fieldKey:'COD_TIPOCARGA',value:'9',expectedUpdatedAt:document.updatedAt})).document;
  assert.equal(document.entries.find(e=>e.id===first.id).values.COD_TIPOCARGA,'9','Bulk corrections remain available');
  assert.equal(document.entries.find(e=>e.id===first.id).source.quantidadeVeiculosConjunto,'2','Corrections do not alter original computed evidence');

  const before=(await documents('list',{status:'all'})).total;
  await denied(()=>saveImport('missing-first',[row('9000',2,'2')],profile.id),/incompleto/);
  await denied(()=>saveImport('missing-middle',[row('9000',1,'1'),row('9000',3,'3')],profile.id),/incompleto/);
  await denied(()=>saveImport('duplicate-sequence',[row('9000',1,'1'),row('9000',1,'2')],profile.id),/repetida/);
  await denied(()=>saveImport('zero-sequence',[row('9000',0,'1')],profile.id),/começar em 1/);
  await denied(()=>saveImport('missing-source',[{...row('9000',1,'1'),source:{entrada:'9000'}}],profile.id),/identificar o conjunto/);
  await denied(()=>saveImport('mismatched-date',[{...row('9000',1,'1'),date:'2026-10-23'}],profile.id),/identificar o conjunto/);
  await denied(()=>saveImport('missing-principal',[row('9000',1,'')],profile.id),/sequência 1/);
  await denied(()=>saveImport('malformed-values',[{...row('9000',1,'1'),values:null}],profile.id));
  assert.equal((await documents('list',{status:'all'})).total,before,'Invalid groups never create partial documents');

  const mappedFields=fields.map(f=>f.sourceKey==='equipamentoPrincipal'?{...f,mappings:{'6269':'ERP200'}}:f.sourceKey==='quantidadeVeiculosConjunto'?{...f,mappings:{'2':'99'}}:f);
  const mapped=(await profiles('save',{...profileInput,name:'Taquari com de para',fields:mappedFields})).profile;
  const mappedDoc=(await saveImport('mapped-principal',[row('2874',1,'6269'),row('2874',2,'6270')],mapped.id)).document;
  assert.equal(mappedDoc.entries[0].values.COD_TIPOCARGA,'2','Vehicle quantity is the count even when the payload or mappings claim another number');
  assert.equal(mappedDoc.entries[0].values.COD_EQUIPAMENTO_TRANSPORTE,'ERP200','Explicit ERP equipment mappings use the real sequence-one source');
  const unmatched=(await saveImport('unmapped-principal',[row('2850',1,'186')],mapped.id)).document;
  assert.equal(unmatched.entries[0].values.COD_EQUIPAMENTO_TRANSPORTE,'','Unmapped ERP equipment remains pending instead of inventing a code');

  const legacyFields=fields.map(f=>f.sourceKey==='quantidadeVeiculosConjunto'?{...f,source:'manual',sourceKey:''}:f);
  const legacy=(await profiles('save',{...profileInput,name:'Taquari legado',fields:legacyFields})).profile;
  const old=(await saveImport('legacy-incomplete',[row('8800',2,'111')],legacy.id)).document;
  await profiles('save',{...profileInput,id:legacy.id,name:legacy.name,expectedUpdatedAt:legacy.updatedAt});
  assert.equal((await documents('get',{id:old.id})).document.entries[0].values.COD_TIPOCARGA,'99','Changing the profile does not rewrite historical snapshots');
  assert.equal((await saveImport('legacy-incomplete',[row('8800',2,'111')],legacy.id)).created,false,'An existing source retry retains the historical document');
  await assert.rejects(()=>db.query('select billing_private.normalize_taquari_vehicle_groups($1::jsonb,$2::jsonb)',['[]','[]']),e=>e.code==='42501');
  await setActor(ids.otherOwner);
  await denied(()=>saveImport('foreign-profile',[row('9000',1,'1')],profile.id));
 }finally{await db.close();}
});
