import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('imports may export and finish incomplete data without changing cells, snapshots or review evidence',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const profiles=(a,p)=>rpc('import-profiles',a,p),docs=(a,p)=>rpc('import-documents',a,p);
 const field=(key,column,type,sourceKey='')=>({key,column,type,sourceKey,source:sourceKey?'pdf':'manual',label:key,required:true,defaultValue:'',mappings:{},pattern:''});
 const input={name:'Pinheiro incomplete allowed',clientId:ids.partner,parser:'pinheiro-usjp-v1',sheetName:'Plan1',startRow:2,
  templateName:'original.xlsx',templateBase64:'VGVtcGxhdGU=',fields:[field('COD_ENTRADA','L','decimal','entradaSequencialConjunto'),field('COD_EQUIPAMENTO_TRANSPORTE','S','decimal'),field('COD_EQUIPAMENTO_COMPARTIMENTO','Y','decimal'),field('CARGA','R','text','quantidadeAnalisesConjunto'),field('DATA','Q','date','dataMovimento'),field('TEXT','A','text'),field('PESO','AA','decimal','pesoBrutoConvencional')]};
 const denied=(fn,code)=>assert.rejects(fn,e=>e.code===code);
 const action=(a,d,p={})=>docs(a,{id:d.id,expectedUpdatedAt:d.updatedAt,...p});
 try{
  const profile=(await profiles('save',input)).profile;
  const source={periodoInicio:'2026-10-24T06:00',periodoFim:'2026-10-25T05:59',dataHoraBA:'2026-10-24T06:48',dataHoraTara:'2026-10-24T07:24',pesoAnalisado:'20.1256'};
  let document=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'incomplete.pdf',sourceHash:'e'.repeat(64),entries:[1,2].map(n=>({date:'2026-10-24',source:{...source,numeroAnalise:String(944380+n)},values:{COD_ENTRADA:'',COD_EQUIPAMENTO_TRANSPORTE:'',COD_EQUIPAMENTO_COMPARTIMENTO:'',CARGA:'',DATA:'',TEXT:'',PESO:''},sourcePage:1,sourceLine:'Original report'}))})).document;
  document=(await action('save-entry',document,{date:'2026-10-24',values:{},reviewed:false})).document;
  assert.equal(document.pendingCount,3);assert.equal(document.entries.at(-1).values.COD_ENTRADA,'');
  const beforeEntries=structuredClone(document.entries),beforeSnapshot=structuredClone(document.profileSnapshot);
  const openExport=await docs('export',{id:document.id});
  assert.equal(openExport.document.status,'open');assert.equal(openExport.document.pendingCount,3);
  assert.deepEqual(openExport.rows[2].values,{L:'',S:'',Y:'',R:'',Q:'',A:'',AA:''});
  assert.equal(openExport.rows[0].values.R,'2');assert.equal(openExport.rows[0].values.AA,'21.1256');
  assert.deepEqual(openExport.columns.map(c=>c.type),['decimal','decimal','decimal','text','date','text','decimal']);
  assert.equal(openExport.document.profileSnapshot.templateBase64,input.templateBase64);
  await denied(()=>action('finalize',document,{expectedUpdatedAt:'2020-01-01'}),'PT409');
  await denied(()=>action('finalize',document,{ownerId:ids.otherOwner}),'22023');
  document=(await action('finalize',document)).document;
  assert.equal(document.status,'finished');assert.ok(document.finishedAt);assert.equal(document.pendingCount,3);
  assert.deepEqual(document.entries,beforeEntries,'Finishing never fills missing codes/equipment or marks entries reviewed');
  assert.deepEqual(document.profileSnapshot,beforeSnapshot,'Original snapshot, numeric/date/text types and template remain intact');
  const finishedExport=await docs('export',{id:document.id});
  assert.deepEqual(finishedExport.rows,openExport.rows);assert.deepEqual(finishedExport.columns,openExport.columns);
  assert.equal((await docs('list',{status:'finished'})).clients[0].summary.pendingCount,3);
  assert.equal((await docs('ledger',{clientId:ids.partner,status:'finished'})).summary.pendingCount,3);
  await denied(()=>action('finalize',document),'23514');
  await denied(()=>action('save-bulk',document,{entryIds:[document.entries[0].id],fieldKey:'TEXT',value:'change'}),'23514');
  document=(await action('reopen',document)).document;
  await denied(()=>action('save-bulk',document,{entryIds:[document.entries[0].id],fieldKey:'COD_ENTRADA',value:'1.5'}),'22023');
  assert.deepEqual((await docs('get',{id:document.id})).document.entries,beforeEntries,'Numbering validation remains atomic after reopening');
  await db.exec('RESET ROLE');await db.query("UPDATE public.billing_access_profiles SET permissions=ARRAY['registrations.read'] WHERE id=$1",[ids.readerProfile]);await setActor(ids.reader);
  assert.equal((await docs('export',{id:document.id})).document.status,'open','Read-only users may export open incomplete documents');
  await denied(()=>action('finalize',document),'42501');
  await setActor(ids.otherOwner);await denied(()=>docs('export',{id:document.id}),'P0002');await denied(()=>action('finalize',document),'P0002');
  await setActor(null);await denied(()=>docs('export',{id:document.id}),'28000');await denied(()=>action('finalize',document),'28000');
  await setActor(ids.owner);
  const taquariProfile=(await profiles('save',{...input,name:'Taquari incomplete allowed',parser:'taquari-equipment-v1',fields:[field('COD_ENTRADA','L','decimal','entradaSequencialConjunto'),field('TEXT','A','text')]})).profile;
  let taquari=(await docs('import',{profileId:taquariProfile.id,clientId:ids.partner,sourceName:'incomplete-tq.pdf',sourceHash:'f'.repeat(64),entries:[{date:'2026-10-25',source:{dataMovimento:'2026-10-25',entrada:'100'},values:{COD_ENTRADA:'',TEXT:''},sourcePage:1,sourceLine:'Taquari original'}]})).document;
  assert.equal(taquari.entries[0].values.COD_ENTRADA,'');taquari=(await action('finalize',taquari)).document;
  assert.equal(taquari.status,'finished');assert.equal(taquari.pendingCount,1);assert.equal(taquari.entries[0].values.COD_ENTRADA,'');
  assert.equal((await docs('export',{id:taquari.id})).rows[0].values.L,'');
  await denied(()=>db.query('update public.billing_import_documents set status=$1 where id=$2',['open',taquari.id]),'42501');
 }finally{await db.close();}
});
