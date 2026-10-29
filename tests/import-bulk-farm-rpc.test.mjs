import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCaneWeighingDb} from '../supabase/tests/helpers/cane-weighing-db.mjs';

test('Pinheiro numeric farm bulk fill persists in detail, filtered table and export without changing source or column type',async()=>{
 const {db,ids}=await createCaneWeighingDb();
 const rpc=async(resource,action,payload={})=>(await db.query('select public.billing_rpc($1,$2,$3::jsonb) result',[resource,action,JSON.stringify(payload)])).rows[0].result;
 const docs=(action,payload)=>rpc('import-documents',action,payload);
 const field=(key,column,type,sourceKey='',mappings={})=>({key,column,type,sourceKey,mappings,source:sourceKey?'pdf':'manual',label:key,required:true,defaultValue:'',pattern:''});
 const fields=[field('COD_FAZENDA','F','decimal','fazendaOrigem',{'311272':'5032'}),field('COD_TALHAO','H','decimal'),field('PESOBRUTO','AA','decimal','pesoBrutoConvencional'),field('TARA','AB','decimal','taraConvencional'),field('DATAMOVIMENTO','Q','date','dataMovimento'),field('COD_TIPOCARGA','R','text','quantidadeAnalisesConjunto')];
 try{
  const profile=(await rpc('import-profiles','save',{name:'Pinheiro farm bulk regression',clientId:ids.partner,parser:'pinheiro-usjp-v1',sheetName:'Plan1',startRow:2,fields})).profile;
  const entries=[1,2,3,4].map((number,index)=>({date:'2026-10-27',source:{periodoInicio:'2026-10-27T06:00',periodoFim:'2026-10-28T05:59',dataHoraBA:index===0?'2026-10-27T09:00':'2026-10-27T13:00',dataHoraTara:index===0?'2026-10-27T09:30':'2026-10-27T13:30',numeroAnalise:String(970000+number),fazendaOrigem:'311999',fazendaNome:'FUNDO SEM EQUIVALÊNCIA',pesoAnalisado:'21.125600'},values:{COD_FAZENDA:'',COD_TALHAO:'21',PESOBRUTO:'',TARA:'',DATAMOVIMENTO:'',COD_TIPOCARGA:''},sourcePage:1,sourceLine:`BA ${970000+number} sem código ERP de fazenda`}));
  let document=(await docs('import',{profileId:profile.id,clientId:ids.partner,sourceName:'pinheiro-unmapped-farm.pdf',sourceHash:createHash('sha256').update('pinheiro-unmapped-farm').digest('hex'),entries})).document;
  assert.equal(document.entryCount,4);assert.deepEqual(document.entries.map(entry=>entry.groupOrdinal),[1,2,2,2]);
  assert.deepEqual(document.entries.map(entry=>entry.values.COD_FAZENDA),['','','',''],'An unknown farm mapping remains blank for manual completion');
  const originalEntries=structuredClone(document.entries),originalFields=structuredClone(document.profileSnapshot.fields);
  const selected=[document.entries[0].id,document.entries[2].id];
  document=(await docs('save-bulk',{id:document.id,entryIds:selected,fieldKey:'COD_FAZENDA',value:'5011',expectedUpdatedAt:document.updatedAt})).document;
  const expected=['5011','','5011',''];
  assert.deepEqual(document.entries.map(entry=>entry.values.COD_FAZENDA),expected);
  assert.equal(document.profileSnapshot.fields.find(field=>field.key==='COD_FAZENDA').type,'decimal');
  assert.deepEqual(document.profileSnapshot.fields,originalFields,'Filling values never changes field source, mappings or numeric type');
  for(const [index,entry] of document.entries.entries()){
   assert.equal(typeof entry.values.COD_FAZENDA,'string');assert.deepEqual(entry.source,originalEntries[index].source,'Manual farm correction preserves the PDF evidence');
   assert.deepEqual({...entry.values,COD_FAZENDA:''},originalEntries[index].values,'Other cells remain unchanged');
   if(!selected.includes(entry.id))assert.deepEqual(entry,originalEntries[index],'Rows outside the selection remain unchanged');
  }
  const detail=await docs('get',{id:document.id});assert.deepEqual(detail.document.entries.map(entry=>entry.values.COD_FAZENDA),expected);
  const table=await docs('table',{id:document.id});assert.deepEqual(table.entries.map(entry=>entry.values.COD_FAZENDA),expected);
  const filtered=await docs('table',{id:document.id,farm:'5011'});assert.deepEqual(filtered.entries.map(entry=>entry.id),selected);assert.equal(filtered.summary.entryCount,2);
  const exported=await docs('export',{id:document.id});assert.equal(exported.columns.find(field=>field.key==='COD_FAZENDA').type,'decimal');assert.deepEqual(exported.rows.map(entry=>entry.values.F),expected);
  const filteredExport=await docs('export-filtered',{id:document.id,farm:'5011',expectedUpdatedAt:document.updatedAt});assert.deepEqual(filteredExport.rows.map(entry=>entry.entryId),selected);assert.deepEqual(filteredExport.rows.map(entry=>entry.values.F),['5011','5011']);
  document=(await docs('save-bulk',{id:document.id,entryIds:document.entries.map(entry=>entry.id),fieldKeys:['COD_FAZENDA'],value:'005011.000000',expectedUpdatedAt:document.updatedAt})).document;
  assert.deepEqual(document.entries.map(entry=>entry.values.COD_FAZENDA),Array(4).fill('5011'),'The complete-column fill stores canonical numeric text');
  assert.deepEqual((await docs('get',{id:document.id})).document.entries.map(entry=>entry.values.COD_FAZENDA),Array(4).fill('5011'));
  assert.deepEqual((await docs('export',{id:document.id})).rows.map(entry=>entry.values.F),Array(4).fill('5011'));
  assert.deepEqual(document.profileSnapshot.fields,originalFields);assert.deepEqual(document.entries.map(entry=>entry.source),originalEntries.map(entry=>entry.source));
  const beforePlot=structuredClone(document.entries);
  document=(await docs('save-bulk',{id:document.id,entryIds:selected,fieldKeys:['COD_TALHAO'],value:'3',expectedUpdatedAt:document.updatedAt})).document;
  assert.deepEqual(document.entries.map(entry=>entry.values.COD_TALHAO),['3','21','3','21'],'Plot updates honor the selected IDs, including within a shared trip');
  for(const [index,entry] of document.entries.entries())if(!selected.includes(entry.id))assert.deepEqual(entry,beforePlot[index],'Unchecked rows remain unchanged');
 }finally{await db.close();}
});
