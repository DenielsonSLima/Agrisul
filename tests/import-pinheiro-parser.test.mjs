import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
async function load(path){const source=readFileSync(new URL(path,import.meta.url),'utf8');const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));}
const {parsePinheiroPages}=await load('../modules/importacoes/utils/pinheiroParser.ts');
const {createPinheiroProfile,PINHEIRO_SOURCE_FIELDS}=await load('../modules/importacoes/utils/pinheiroDefaults.ts');
const header='Período da Entrada de Cana - Início: 24/10/2026 06:00 Fim: 25/10/2026 05:59';
const tail='31,650 14,75 17,15 57,94 150,22 0,80 14,1114 14,02 78,23 82,28 11,5355 115,22 71,23 -7,6039';
const row=(ba='944382',tara='24/10 07:24',arrival='24/10 06:48',analysis=tail)=>`311272-TAPERA ${tara} ${arrival} ${ba} ${analysis}`;
const pages=lines=>[{number:1,lines:[header,...lines]}];
const profile=createPinheiroProfile();

test('Pinheiro keeps its own 46 headers, native sample types and explicit mappings',()=>{
 assert.equal(profile.parser,'pinheiro-usjp-v1');assert.equal(profile.fields.length,46);assert.equal(profile.fields.at(-1).column,'AT');assert.equal(profile.sheetName,'Plan1');assert.equal(profile.startRow,2);
 const field=key=>profile.fields.find(field=>field.key===key);
 assert.equal(profile.fields.filter(field=>field.type==='decimal').length,18);assert.equal(profile.fields.filter(field=>field.type==='date').length,3);
 for(const key of ['COD_TIPOCOLHEITA','COD_TIPOCARGA','HORACHEGADA','HORASAIDA'])assert.equal(field(key).type,'text');
 const empty=['COD_FUNCIONARIO','DATACARREGAMENTO','HORACARREGAMENTO','ORDEM_CARREGAMENTO','NUMERO_ANALISE','PBU','LEITURA_SACARIMETRICA','BRIX','POL','COD_COLHEDORA','COD_OPER_COLHEDORA_TERCEIRO','COD_OPER_COLHEDORA_FUNCIONARIO','COD_TRANSBORDO','COD_OPER_TRANSBORDO_TERCEIRO','COD_OPER_TRANSBORDO_FUNCIONA','COD_CARREGADEIRA','COD_OPER_CARREGADEIRA_TERCEIRO','COD_OPER_CARREGADEIRA_FUNCIONA','COD_TRATOR_REBOQUE','COD_OPER_TRATOREBO_TERCEIRO','COD_OPER_TRATOREBO_FUNCIONARIO'];
 assert.equal(empty.length,21);for(const key of empty){assert.equal(field(key).source,'manual');assert.equal(field(key).type,'text');assert.equal(field(key).defaultValue,'');}
 assert.equal(field('COD_TERCEIRO').defaultValue,'1');assert.equal(field('COD_FRENTE').defaultValue,'26');assert.deepEqual(field('COD_FAZENDA').mappings,{'311272':'5032'});
 assert.equal(field('COD_TALHAO').source,'manual');assert.equal(field('AREA').sourceKey,'talhao');assert.deepEqual(field('AREA').mappings,{'15':'19.56','21':'19.52'});
 assert.equal(field('NR_ORDEM_COLHEITA').source,'manual');assert.equal(field('NR_ORDEM_COLHEITA').required,false);assert.equal(field('NR_ORDEM_COLHEITA').type,'decimal');assert.deepEqual(field('NR_ORDEM_COLHEITA').mappings,{});
 assert.equal(field('COD_EQUIPAMENTO_TRANSPORTE').source,'manual');assert.equal(field('COD_EQUIPAMENTO_COMPARTIMENTO').source,'manual');assert.equal(field('COD_ENTRADA').source,'manual');assert.ok(PINHEIRO_SOURCE_FIELDS.some(([key])=>key==='pesoAnalisado'));
});

test('extracts the five demonstrated report rows without inventing ERP, vehicle or conventional weights',()=>{
 const lines=[row(),row('944383','24/10 07:24','24/10 06:48',tail.replace('31,650','31,660')),row('944379','24/10 07:31','24/10 06:45',tail.replace('31,650','18,750')),row('944380','24/10 07:31','24/10 06:45',tail.replace('31,650','18,750')),row('944381','24/10 07:31','24/10 06:45',tail.replace('31,650','18,750'))];
 const result=parsePinheiroPages(pages(lines),profile);assert.equal(result.entries.length,5);
 assert.deepEqual(result.entries.map(entry=>entry.source.numeroAnalise),['944382','944383','944379','944380','944381']);
 const first=result.entries[0];assert.equal(first.source.dataHoraBA,'2026-10-24T06:48');assert.equal(first.source.dataHoraTara,'2026-10-24T07:24');assert.equal(first.source.periodoInicio,'2026-10-24T06:00');assert.equal(first.source.periodoFim,'2026-10-25T05:59');assert.equal(first.source.pesoAnalisado,'31.650');assert.equal(first.source.agio,'-7.6039');assert.equal(first.values.COD_FAZENDA,'5032');assert.equal(first.values.COD_TERCEIRO,'1');assert.equal(first.values.COD_TIPOCOLHEITA,'2');
 for(const entry of result.entries){assert.equal(entry.date,'2026-10-24');for(const key of ['quantidadeAnalisesConjunto','sequencia','taraConvencional','pesoBrutoConvencional'])assert.equal(entry.source[key],'');for(const key of ['COD_ENTRADA','COD_TALHAO','AREA','NR_ORDEM_COLHEITA','COD_EQUIPAMENTO_TRANSPORTE','COD_EQUIPAMENTO_COMPARTIMENTO','COD_TIPOCARGA','PESOBRUTO','TARA','NUMERO_ANALISE','PBU','BRIX','POL'])assert.equal(entry.values[key],'');}
 assert.ok(result.warnings.length);
});

test('keeps all 22 candidates across pages and handles omitted, individual or zero optional analytical cells',()=>{
 const both='33,890 17,08 19,83 70,52 148,34 0,0 0,73 16,9885 13,87 81,52 85,67 13,9234 136,90 69,05 0 15,8471';
 const onlyPh=both.replace('69,05 0 15,8471','69,05 15,8471');const onlyAmido=both.replace('148,34 0,0','148,34');
 const rows=Array.from({length:22},(_,index)=>row(String(944000+index),'24/10 17:30','24/10 16:47',[tail,both,onlyPh,onlyAmido][index%4]));
 const result=parsePinheiroPages([{number:1,lines:[header,...rows.slice(0,11)]},{number:2,lines:[header,...rows.slice(11)]}],profile);
 assert.equal(result.entries.length,22);assert.equal(result.entries[11].sourcePage,2);assert.equal(result.entries[0].source.ph,'');assert.equal(result.entries[0].source.amido,'');assert.equal(result.entries[1].source.ph,'0.0');assert.equal(result.entries[1].source.amido,'0');assert.equal(result.entries[2].source.ph,'0.0');assert.equal(result.entries[2].source.amido,'');assert.equal(result.entries[3].source.ph,'');assert.equal(result.entries[3].source.amido,'0');assert.equal(result.entries[1].source.arCana,'0.73');assert.equal(result.entries[1].source.atr,'136.90');
});

test('resolves after-midnight and year rollover dates from the agricultural period, retaining actual civil dates',()=>{
 const overnight=parsePinheiroPages(pages([row('944694','25/10 04:37','25/10 02:32')]),profile).entries[0];assert.equal(overnight.date,'2026-10-24');assert.equal(overnight.source.dataChegada,'2026-10-25');assert.equal(overnight.source.dataSaida,'2026-10-25');
 const rollover='Início: 31/12/2026 06:00 Fim: 01/01/2027 05:59';const result=parsePinheiroPages([{number:1,lines:[rollover,row('1','01/01 04:37','01/01 02:32')]}],profile).entries[0];assert.equal(result.source.dataHoraBA,'2027-01-01T02:32');assert.equal(result.date,'2026-12-31');
});

test('tara can finish after the entry period without shifting the movement or inventing a future year',()=>{
 const result=parsePinheiroPages(pages([row('1','25/10 06:30','25/10 05:50'),row('2','25/10 06:30','25/10 05:50')]),profile);
 assert.equal(result.entries.length,2);for(const entry of result.entries){assert.equal(entry.date,'2026-10-24');assert.equal(entry.source.dataHoraBA,'2026-10-25T05:50');assert.equal(entry.source.dataHoraTara,'2026-10-25T06:30');}
 const newYear='Início: 31/12/2026 06:00 Fim: 01/01/2027 05:59';const entry=parsePinheiroPages([{number:1,lines:[newYear,row('3','01/01 06:30','31/12 23:30')]}],profile).entries[0];assert.equal(entry.source.dataHoraTara,'2027-01-01T06:30');
 assert.throws(()=>parsePinheiroPages(pages([row('4','23/10 07:24')]),profile),/tara.*anterior ao BA/);
 assert.throws(()=>parsePinheiroPages(pages([row('4','01/01 07:24')]),profile),/tara.*anterior ao BA/);
 const explicit=parsePinheiroPages(pages([row('5','25/10/2027 06:30')]),profile).entries[0];assert.equal(explicit.source.dataHoraTara,'2027-10-25T06:30');
});

test('refuses malformed candidates, duplicate BAs, invalid dates/hours and conflicting/outside periods',()=>{
 assert.throws(()=>parsePinheiroPages(pages([row(),row()]),profile),/BA repetido/);
 assert.throws(()=>parsePinheiroPages(pages([row(),row('2').replace('31,650','31?650')]),profile),/não puderam ser lidos/);
 assert.throws(()=>parsePinheiroPages(pages([row(),row('2').replaceAll('24/10','24?10')]),profile),/Estrutura da linha/);
 assert.throws(()=>parsePinheiroPages(pages([row('2','24/10 25:00')]),profile),/Hora inválida/);
 assert.throws(()=>parsePinheiroPages(pages([row('2','24/10 07:24','24/10 05:59')]),profile),/fora do período/);
 assert.throws(()=>parsePinheiroPages(pages([row('2','31/02 07:24')]),profile),/Data inválida/);
 assert.throws(()=>parsePinheiroPages([{number:1,lines:[row()]}],profile),/Período agrícola/);
 assert.throws(()=>parsePinheiroPages([{number:1,lines:[header,'Início: 25/10/2026 06:00 Fim: 26/10/2026 05:59',row()]}],profile),/períodos agrícolas diferentes/);
 assert.throws(()=>parsePinheiroPages(pages(['Foto sem texto']),profile),/OCR/);
});

test('explicit configuration can expose source analytics while derived source patterns remain server-owned',()=>{
 const configured=createPinheiroProfile();Object.assign(configured.fields.find(field=>field.key==='PBU'),{source:'pdf',sourceKey:'pbu',type:'decimal'});Object.assign(configured.fields.find(field=>field.key==='NUMERO_ANALISE'),{source:'pdf',sourceKey:'numeroAnalise',type:'text'});Object.assign(configured.fields.find(field=>field.key==='TARA'),{pattern:'(31,650)',defaultValue:'123'});
 const result=parsePinheiroPages(pages([row()]),configured).entries[0];assert.equal(result.values.PBU,'150.22');assert.equal(result.values.NUMERO_ANALISE,'944382');assert.equal(result.values.TARA,'');
});
