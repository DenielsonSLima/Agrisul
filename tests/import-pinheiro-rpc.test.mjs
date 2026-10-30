import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('Pinheiro: separate source contract, agricultural period, conventional NUMERIC weights and authoritative group decoration',async()=>{
 const {db,ids,setActor}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const profiles=(action,payload)=>rpc('import-profiles',action,payload);
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const field=(key,column,type,sourceKey='',defaultValue='',source=sourceKey?'pdf':'manual')=>({key,column,type,sourceKey,defaultValue,source,label:key,required:false,mappings:{},pattern:''});
 const fields=[
  field('COD_TIPOCOLHEITA','K','text','','2','fixed'),field('COD_TIPOCARGA','R','text','quantidadeAnalisesConjunto'),
  field('PESOBRUTO','AA','decimal','pesoBrutoConvencional'),field('TARA','AB','decimal','taraConvencional'),
  field('DATACHEGADA','M','date','dataChegada'),field('HORACHEGADA','N','text','horaChegada'),
  field('DATASAIDA','O','date','dataSaida'),field('HORASAIDA','P','text','horaSaida'),field('DATAMOVIMENTO','Q','date','dataMovimento'),
  field('COD_TERCEIRO','U','decimal','','1','fixed'),field('COD_ENTRADA','L','decimal'),
  field('COD_EQUIPAMENTO_TRANSPORTE','S','decimal'),field('COD_EQUIPAMENTO_COMPARTIMENTO','Y','decimal'),
  field('NR_ORDEM_COLHEITA','AC','decimal'),field('SEQUENCIA','','text','sequencia'),
 ];
 const profileInput={name:'USJP próprio',clientId:ids.partner,parser:'pinheiro-usjp-v1',sheetName:'Plan1',startRow:2,fields};
 const row=(ba,time,tare,peso='28.175')=>({date:'2000-01-01',source:{
  periodoInicio:'2026-10-24T06:00',periodoFim:'2026-10-25T05:59',dataHoraBA:time,dataHoraTara:tare,
  numeroAnalise:ba,fazendaOrigem:'311272',fazendaNome:'FUNDO PINHEIRO',pesoAnalisado:peso,
  sequencia:'99',quantidadeAnalisesConjunto:'99',taraConvencional:'99',pesoBrutoConvencional:'999',dataMovimento:'2000-01-01',
  groupKey:'forged-source-key',groupOrdinal:'99',guiaNumero:'0162',
 },values:Object.fromEntries(fields.map(f=>[f.key,f.defaultValue||(['date'].includes(f.type)?'2000-01-01':f.source==='pdf'?'999':'')])),sourcePage:1,sourceLine:`BA ${ba} - fonte original`});
 const imported=(profileId,label,entries)=>docs('import',{profileId,clientId:ids.partner,sourceName:`${label}.pdf`,sourceHash:createHash('sha256').update(label).digest('hex'),entries});
 const denied=(fn,match)=>assert.rejects(fn,e=>e.code==='22023'&&(!match||match.test(e.message)));
 try{
  const {profile}=await profiles('save',profileInput);
  await denied(()=>profiles('save',{...profileInput,name:'Mistura Taquari',fields:[field('BAD','A','text','quantidadeVeiculosConjunto')]}));
  await denied(()=>profiles('save',{...profileInput,name:'Mistura Pinheiro',parser:'taquari-equipment-v1',fields:[field('BAD','A','text','taraConvencional')]}));
  const rows=[
   row('944382','2026-10-24T06:48','2026-10-24T07:24'),row('944383','2026-10-24T06:48','2026-10-24T07:24','24.125600'),
   row('944381','2026-10-24T06:45','2026-10-24T07:21','20'),row('944379','2026-10-24T06:45','2026-10-24T07:21','21'),row('944380','2026-10-24T06:45','2026-10-24T07:21','22'),
   row('944384','2026-10-25T01:10','2026-10-25T02:03','10'),row('944385','2026-10-25T01:10','2026-10-25T02:03','11'),
   row('944386','2026-10-24T06:48','2026-10-24T08:24','12'),row('944387','2026-10-24T06:48','2026-10-24T08:24','13'),
  ];
  rows[0].values.COD_ENTRADA='806';rows[0].values.COD_EQUIPAMENTO_TRANSPORTE='308';rows[0].values.COD_EQUIPAMENTO_COMPARTIMENTO='309';
  const initial=await imported(profile.id,'pinheiro-valid',rows);let document=initial.document;
  assert.equal(initial.created,true);assert.equal(document.entryCount,9);assert.equal(document.profileSnapshot.parser,'pinheiro-usjp-v1');
  assert.deepEqual(document.entries.map(e=>e.groupOrdinal),[1,1,2,2,2,3,3,4,4],'Report order controls the group ordinal, not BA number or chronological time');
  assert.equal(new Set(document.entries.map(e=>e.groupKey)).size,4,'The analysis/tare pair is the complete group identity');
  assert.deepEqual(document.entries.map(e=>e.values.COD_TIPOCARGA),['2','2','3','3','3','2','2','2','2']);
  assert.deepEqual(document.entries.map(e=>e.values.TARA),['1','2','1','2','3','1','2','1','2']);
  assert.deepEqual(document.entries.map(e=>e.values.PESOBRUTO),['29.175','26.1256','21','23','25','11','13','13','15']);
  assert.deepEqual(document.entries.map(e=>e.source.sequencia),['1','2','1','2','3','1','2','1','2']);
  assert.equal(document.entries.every(e=>e.date==='2026-10-24'&&e.values.DATAMOVIMENTO==='2026-10-24'),true,'The report agricultural period determines movement, including next-day BAs');
  assert.equal(document.entries[5].values.DATACHEGADA,'2026-10-25');assert.equal(document.entries[5].values.HORACHEGADA,'01:10');
  assert.equal(document.entries[0].values.DATASAIDA,'2026-10-24');assert.equal(document.entries[0].values.HORASAIDA,'07:24');
  assert.equal(document.entries.every(e=>e.values.COD_TERCEIRO==='1'),true,'The Pinheiro profile never inherits Taquari third-party code 77');
  assert.equal(document.entries[0].values.COD_ENTRADA,'806');assert.equal(document.entries[0].values.COD_EQUIPAMENTO_COMPARTIMENTO,'309');
  assert.equal(document.entries[5].values.COD_ENTRADA,'');assert.equal(document.entries[5].values.COD_EQUIPAMENTO_TRANSPORTE,'');
  assert.equal(document.entries[0].source.pesoAnalisado,'28.175');assert.equal(document.entries[0].source.dataHoraBA,rows[0].source.dataHoraBA);
  assert.equal(document.entries[0].source.groupOrdinal,'99');assert.equal(document.entries[0].groupOrdinal,1,'Caller source decoration never controls the read projection');
  assert.equal(typeof document.entries[0].values.PESOBRUTO,'string');assert.equal(document.profileSnapshot.fields.find(f=>f.key==='COD_TIPOCARGA').type,'text');
  assert.equal(document.profileSnapshot.fields.find(f=>f.key==='COD_TIPOCOLHEITA').type,'text');
  assert.equal((await imported(profile.id,'pinheiro-valid',rows)).created,false);

  const stored=async()=>(await db.query('select jsonb_agg(to_jsonb(e) order by position) rows from public.billing_import_entries e where owner_id=$1 and document_id=$2',[ids.owner,document.id])).rows[0].rows;
  const persistedBefore=await stored();const detail=await docs('get',{id:document.id});const listed=await docs('list',{status:'all'});
  assert.deepEqual(await stored(),persistedBefore,'Group keys and ordinals are projected without writing historical source rows');
  assert.equal(detail.summary.groupCount,4);assert.equal(detail.daySummaries[0].summary.groupCount,4);
  assert.equal(listed.clients[0].summary.groupCount,4);assert.equal(listed.clients[0].days[0].summary.groupCount,4);
  assert.equal('entries' in listed.clients[0].days[0].documents[0],false);

  const first=document.entries[0];document=(await docs('save-entry',{id:document.id,entryId:first.id,date:first.date,values:{...first.values,PESOBRUTO:'50',COD_TIPOCARGA:'8'},reviewed:false,expectedUpdatedAt:document.updatedAt})).document;
  assert.equal(document.entries[0].values.PESOBRUTO,'50');assert.equal(document.entries[0].values.COD_TIPOCARGA,'8');assert.equal(document.entries[0].source.pesoBrutoConvencional,'29.175');assert.equal(document.entries[0].groupOrdinal,1);
  document=(await docs('save-bulk',{id:document.id,entryIds:[first.id],fieldKey:'TARA',value:'9',expectedUpdatedAt:document.updatedAt})).document;
  assert.equal(document.entries[0].values.TARA,'9');assert.equal(document.entries[0].source.taraConvencional,'1');assert.equal(document.entries[0].groupOrdinal,1);
  document=(await docs('save-entry',{id:document.id,date:'2026-10-24',values:{},reviewed:false,expectedUpdatedAt:document.updatedAt})).document;
  const manual=document.entries.at(-1);assert.equal(manual.groupKey,null);assert.equal(manual.groupOrdinal,null);
  assert.equal((await docs('get',{id:document.id})).summary.groupCount,4,'Manual entries without source evidence do not invent vehicle groups');

  const boundary=[row('950001','2026-10-25T05:59','2026-10-25T06:30'),row('950002','2026-10-25T05:59','2026-10-25T06:30')];
  const late=(await imported(profile.id,'closing-minute',boundary)).document;assert.equal(late.entries[0].date,'2026-10-24');assert.equal(late.entries[0].values.HORASAIDA,'06:30');
  const early=(tare='2026-10-24T06:13',flag='true')=>[0,1,2].map(i=>{
   const entry=row(String(951001+i),'2026-10-24T05:22',tare,'18.760');entry.source.relatorioPorDataTara=flag;return entry;
  });
  const taraPeriod=(await imported(profile.id,'data-tara-opening',early())).document;
  assert.equal(taraPeriod.entries.length,3);assert.equal(taraPeriod.entries[0].source.dataHoraBA,'2026-10-24T05:22');
  assert.equal(taraPeriod.entries[0].source.dataHoraTara,'2026-10-24T06:13');assert.equal(taraPeriod.entries[0].date,'2026-10-24');
  assert.deepEqual(taraPeriod.entries.map(e=>e.values.TARA),['1','2','3']);
  await denied(()=>imported(profile.id,'pre-opening-no-evidence',early(undefined,'')),/dentro do período/);
  await denied(()=>imported(profile.id,'pre-opening-tare-before',early('2026-10-24T05:59')),/dentro do período/);
  await denied(()=>imported(profile.id,'pre-opening-tare-after',early('2026-10-25T06:00')),/dentro do período/);
  for(const quantity of [1,2,3,4,5,6]){
   const minute=String(quantity).padStart(2,'0');
   const groupRows=Array.from({length:quantity},(_,index)=>row(String(960000+quantity*10+index),`2026-10-24T09:${minute}`,`2026-10-24T10:${minute}`,'12345678901234.123456'));
   const grouped=(await imported(profile.id,`pinheiro-${quantity}-analyses`,groupRows)).document;
   const sequences=Array.from({length:quantity},(_,index)=>String(index+1));
   const gross=sequences.map(sequence=>`${12345678901234n+BigInt(sequence)}.123456`);
   assert.equal(grouped.entryCount,quantity,`A complete source group may contain ${quantity} analyses`);
   assert.deepEqual(grouped.entries.map(e=>e.source.quantidadeAnalisesConjunto),Array(quantity).fill(String(quantity)));
   assert.deepEqual(grouped.entries.map(e=>e.values.COD_TIPOCARGA),Array(quantity).fill(String(quantity)));
   assert.deepEqual(grouped.entries.map(e=>e.source.sequencia),sequences);
   assert.deepEqual(grouped.entries.map(e=>e.values.TARA),sequences);
   assert.deepEqual(grouped.entries.map(e=>e.source.taraConvencional),sequences);
   assert.deepEqual(grouped.entries.map(e=>e.values.PESOBRUTO),gross,'Conventional gross weight keeps exact NUMERIC precision for every sequence');
   assert.deepEqual(grouped.entries.map(e=>e.source.pesoBrutoConvencional),gross);
   assert.equal(new Set(grouped.entries.map(e=>e.groupKey)).size,1);
   assert.equal(grouped.entries.every(e=>e.groupKey&&e.groupOrdinal===1&&e.date==='2026-10-24'),true);
   const detail=await docs('get',{id:grouped.id});assert.equal(detail.summary.entryCount,quantity);assert.equal(detail.summary.groupCount,1);
   const exported=await docs('export',{id:grouped.id});
   assert.deepEqual(exported.rows.map(e=>e.entryId),grouped.entries.map(e=>e.id));
   assert.deepEqual(exported.rows.map(e=>e.values.AA),gross);
   assert.deepEqual(exported.rows.map(e=>e.values.AB),sequences);
   assert.deepEqual(exported.rows.map(e=>e.values.R),Array(quantity).fill(String(quantity)));
  }
  const before=(await docs('list',{status:'all'})).total;
  await denied(()=>imported(profile.id,'duplicate-ba',[rows[0],rows[0]]),/BA repetido/);
  const modified=(key,value)=>[0,1].map(i=>({...rows[i],source:{...rows[i].source,[key]:value}}));
  await denied(()=>imported(profile.id,'bad-period',modified('periodoFim','2026-10-25T06:00')),/período/);
  await denied(()=>imported(profile.id,'invalid-date',modified('dataHoraBA','2026-02-30T06:48')),/datas originais/);
  await denied(()=>imported(profile.id,'normalized-midnight-ba',[
   row('950011','2026-10-24T24:00','2026-10-25T00:30'),row('950012','2026-10-24T24:00','2026-10-25T00:30'),
  ]),/datas originais/);
  await denied(()=>imported(profile.id,'normalized-midnight-tara',[
   row('950013','2026-10-24T23:30','2026-10-24T24:00'),row('950014','2026-10-24T23:30','2026-10-24T24:00'),
  ]),/datas originais/);
  await denied(()=>imported(profile.id,'invalid-midnight-period-start',modified('periodoInicio','2026-10-24T24:00')),/datas originais/);
  await denied(()=>imported(profile.id,'invalid-midnight-period-end',modified('periodoFim','2026-10-24T24:00')),/datas originais/);
  for(const sourceKey of ['dataHoraBA','dataHoraTara','periodoInicio','periodoFim']){
   await denied(()=>imported(profile.id,`invalid-minute-${sourceKey}`,modified(sourceKey,'2026-10-24T06:60')),/datas originais/);
  }
  await denied(()=>imported(profile.id,'outside-period',modified('dataHoraBA','2026-10-25T06:00')),/dentro do período/);
  await denied(()=>imported(profile.id,'tara-before-ba',modified('dataHoraTara','2026-10-24T06:30')),/anteceder/);
  await denied(()=>imported(profile.id,'bad-weight',modified('pesoAnalisado','12.1.2')),/peso analisado/);
  await denied(()=>imported(profile.id,'number-weight',modified('pesoAnalisado',12)),/peso analisado/);
  await denied(()=>imported(profile.id,'forged-top-decoration',rows.slice(0,2).map(e=>({...e,groupKey:'evil',groupOrdinal:99}))));
  assert.equal((await docs('list',{status:'all'})).total,before,'Invalid Pinheiro inputs cannot partially commit a document');

  const taquariFields=[field('CARGA','A','text','quantidadeVeiculosConjunto'),field('TRANSPORTE','B','text','equipamentoPrincipal'),field('TERCEIRO','C','text','','77','fixed')];
  const taquari=(await profiles('save',{...profileInput,name:'Taquari isolada',parser:'taquari-equipment-v1',fields:taquariFields})).profile;
  const tq=(await imported(taquari.id,'taquari-unchanged',[1,2].map(sequence=>({date:'2026-10-24',source:{dataMovimento:'2026-10-24',entrada:'2874',sequencia:String(sequence),equipamento:sequence===1?'6269':'6270'},values:{CARGA:'99',TRANSPORTE:'999',TERCEIRO:'77'},sourcePage:1,sourceLine:'Original Taquari'})))).document;
  assert.deepEqual(tq.entries.map(e=>e.values.CARGA),['2','2']);assert.deepEqual(tq.entries.map(e=>e.values.TRANSPORTE),['6269','6269']);assert.equal(tq.entries[0].values.TERCEIRO,'77');
  assert.equal(tq.entries[0].groupOrdinal,1);assert.equal(tq.entries[0].groupKey,tq.entries[1].groupKey);
  await assert.rejects(()=>db.query('select billing_private.normalize_pinheiro_analyses($1::jsonb,$2::jsonb)',['[]','[]']),e=>e.code==='42501');
  await setActor(ids.otherOwner);await assert.rejects(()=>docs('get',{id:document.id}),e=>e.code==='P0002');assert.equal((await docs('list',{status:'all'})).total,0);
  await denied(()=>imported(profile.id,'foreign-profile',rows));
  await setActor(null);await assert.rejects(()=>docs('get',{id:document.id}),e=>e.code==='28000');
 }finally{await db.close();}
});
