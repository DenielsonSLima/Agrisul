import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

async function load(path) {
  const source = readFileSync(new URL(path,import.meta.url),'utf8');
  const {outputText} = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
  return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
}
const {parseTaquariPages,documentDecimal,isoDate} = await load('../modules/importacoes/utils/taquariParser.ts');
const {createTaquariProfile,excelColumn} = await load('../modules/importacoes/utils/defaults.ts');
const line1 = '2874 1 22/10/2026 06:18 22/10/2026 06:19 22/10/2026 1582-1-54 649 552 7229 N N 6269 61,310 23,520 37,790';
const line2 = '2874 2 22/10/2026 06:18 22/10/2026 06:19 22/10/2026 1582-1-54 649 552 7230 N N 6270 49,070 14,420 34,650';
const line3 = '2894 2 22/10/2026 12:06 22/10/2026 13:39 22/10/2026 1591-1-19 647 550 7288 N N 279 NF123 28,950 10,330 18,620';

test('extracts individual compartments, carries farm context across pages, preserves decimal text', () => {
  const profile = createTaquariProfile();
  const {entries,warnings} = parseTaquariPages([
    {number:1,lines:['Data Movimento: 22/10/2026','Fdo Agrícola: 1582 - SANTANA I',line1,line2,'Fdo Agrícola: 1591 - SANTANA 2']},
    {number:2,lines:['Relatório de Colheita','Entrada Seq. Data',line3,'TOTAL - Geral 1.028,400 388,680 639,720']},
  ],profile);
  assert.equal(entries.length,3);
  assert.equal(entries[1].source.equipamento,'6270');
  assert.equal(entries[1].source.sequencia,'2');
  assert.equal(entries[0].source.fazendaNome,'SANTANA I');
  assert.equal(entries[2].source.fazendaNome,'SANTANA 2');
  assert.equal(entries[2].source.notaFiscal,'NF123');
  assert.equal(entries[2].sourcePage,2);
  assert.equal(entries[0].date,'2026-10-22');
  assert.equal(entries[0].values.PESOBRUTO,'61.310');
  assert.equal(entries[0].values.TARA,'23.520');
  assert.equal(entries[0].values.HORACHEGADA,'06:18');
  // Transaction entry IDs are not generated from template preparation rows.
  assert.equal(entries[0].values.COD_ENTRADA,'');
  assert.equal(entries[0].values.NR_ORDEM_COLHEITA,'134');
  assert.equal(entries[0].values.COD_EQUIPAMENTO_TRANSPORTE,'6269');
  assert.equal(entries[1].values.COD_EQUIPAMENTO_COMPARTIMENTO,'6269');
  assert.equal(entries[1].source.equipamento,'6270');
  assert.equal(entries[2].values.COD_EQUIPAMENTO_TRANSPORTE,'');
  assert.equal(entries[0].values.AREA,'18.07');
  assert.equal(entries[2].values.AREA,'11.1');
  assert.equal(entries[0].values.COD_FAZENDA,'5010');
  assert.equal(entries[2].values.COD_FAZENDA,'5011');
  assert.ok(warnings.length);
});

test('configuration selects original fields, explicit mappings, regex captures and fixed/manual defaults', () => {
  const profile = createTaquariProfile();
  const farm = profile.fields.find(f=>f.key==='COD_FAZENDA');
  Object.assign(farm,{source:'pdf',sourceKey:'fazendaOrigem',mappings:{1582:'5010'}});
  const order = profile.fields.find(f=>f.key==='NR_ORDEM_COLHEITA');
  Object.assign(order,{source:'manual',defaultValue:'134'});
  profile.fields.push({key:'EXTRACTED',label:'Equipamento',source:'pdf',type:'text',required:false,column:'AU',defaultValue:'',pattern:'N N (\\d+)'});
  const {entries} = parseTaquariPages([{number:1,lines:[line1]}],profile);
  assert.equal(entries[0].values.COD_FAZENDA,'5010');
  assert.equal(entries[0].source.fazendaOrigem,'1582');
  assert.equal(entries[0].values.NR_ORDEM_COLHEITA,'134');
  assert.equal(entries[0].values.EXTRACTED,'6269');
  assert.equal(entries[0].values.COD_EMPRESA,'2');
  const unknown = parseTaquariPages([{number:1,lines:[line1.replace('1582-1-54','9999-1-54')]}],profile);
  assert.equal(unknown.entries[0].values.COD_FAZENDA,'');
  assert.equal(unknown.entries[0].source.fazendaOrigem,'9999');
});

test('refuses incomplete or repeated extraction instead of silently dropping rows', () => {
  const profile = createTaquariProfile();
  assert.throws(()=>parseTaquariPages([{number:1,lines:[line1,line2.replace('49,070','49?070')]}],profile),/não puderam ser lidos/);
  assert.throws(()=>parseTaquariPages([{number:1,lines:[line1,line1]}],profile),/Linha repetida/);
  assert.throws(()=>parseTaquariPages([{number:1,lines:['Relatório em imagem']}],profile),/OCR/);
  assert.throws(()=>parseTaquariPages([{number:1,lines:[line1.replaceAll('22/10/2026','31/02/2026')]}],profile),/Data inválida/);
});

test('decimal conversion is lexical and the template keeps all 46 ERP columns in order', () => {
  assert.equal(documentDecimal('1.028,400'),'1028.400');
  assert.equal(documentDecimal('0,000'),'0.000');
  assert.equal(isoDate('22/10/2026'),'2026-10-22');
  assert.throws(()=>documentDecimal('1,2,3'),/inválido/);
  const profile = createTaquariProfile();
  assert.equal(profile.fields.length,46);
  assert.equal(profile.fields[0].key,'COD_GRUPOEMPRESA');
  assert.equal(profile.fields[45].key,'COD_TIPOCULTURA');
  assert.equal(profile.fields[45].column,'AT');
  assert.equal(profile.sheetName,'Plan1');
  assert.equal(profile.startRow,2);
  assert.equal(excelColumn(26),'AA');
});

test('uses actual sequence-one equipment across pages and leaves unknown plot/order/transaction codes empty',()=>{
  const profile=createTaquariProfile();
  const {entries}=parseTaquariPages([{number:1,lines:[line1]},{number:2,lines:[line2]}],profile);
  assert.equal(entries[1].source.equipamentoPrincipal,'6269');
  assert.equal(entries[1].values.COD_EQUIPAMENTO_TRANSPORTE,'6269');
  assert.equal(entries[1].values.COD_EQUIPAMENTO_COMPARTIMENTO,'6269');
  assert.equal(entries[1].source.fazendaZonaTalhao,'1582-1-54');
  const unknownLine='2920 1 22/10/2026 17:48 22/10/2026 17:50 22/10/2026 1591-1-3 656 559 7339 N N 128 41,400 15,070 26,330';
  const unknown=parseTaquariPages([{number:1,lines:[unknownLine]}],profile).entries[0];
  assert.equal(unknown.values.AREA,'');
  assert.equal(unknown.values.NR_ORDEM_COLHEITA,'');
  assert.equal(unknown.values.COD_ENTRADA,'');
  assert.equal(unknown.values.COD_TIPOCOLHEITA,'1');
  assert.equal(unknown.values.COD_TIPOCARGA,'3');
});

test('does not borrow principal equipment from another movement date or agricultural fund',()=>{
  const profile=createTaquariProfile();
  const nextDay=line2.replaceAll('22/10/2026','23/10/2026');
  const otherFund=line2.replace('1582-1-54','1591-1-19').replace('7230','7231');
  const {entries,warnings}=parseTaquariPages([{number:1,lines:[line1,nextDay,otherFund]}],profile);
  assert.equal(entries[0].source.equipamentoPrincipal,'6269');
  assert.equal(entries[1].source.equipamentoPrincipal,'');
  assert.equal(entries[2].source.equipamentoPrincipal,'');
  assert.equal(entries[1].values.COD_EQUIPAMENTO_TRANSPORTE,'');
  assert.equal(entries[2].values.COD_EQUIPAMENTO_COMPARTIMENTO,'');
  assert.ok(warnings.some(warning=>warning.includes('sequência 1 inequívoca')));
});
