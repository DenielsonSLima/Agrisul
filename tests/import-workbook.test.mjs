import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import ExcelJS from 'exceljs/dist/exceljs.min.js';

const require = createRequire(import.meta.url);
function source(name) {
  const input = readFileSync(new URL(`../modules/importacoes/utils/${name}.ts`,import.meta.url),'utf8');
  return ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
}
const dataUrl = text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const defaultsUrl = dataUrl(source('defaults'));
const parserUrl = dataUrl(source('taquariParser'));
const pinheiroUrl = dataUrl(source('pinheiroParser'));
const ioSource = source('documentIO').replaceAll("'./defaults'",JSON.stringify(defaultsUrl)).replaceAll("'./taquariParser'",JSON.stringify(parserUrl)).replaceAll("'./pinheiroParser'",JSON.stringify(pinheiroUrl))
  .replace("import('exceljs/dist/exceljs.min.js')",`import(${JSON.stringify(pathToFileURL(require.resolve('exceljs/dist/exceljs.min.js')).href)})`);
const {createImportWorkbook,inspectWorkbookTemplate} = await import(dataUrl(ioSource));

test('exports native dates/numbers, preserves zeros and formula-looking text, clears old template records',async()=>{
  const template = new ExcelJS.Workbook();
  const sheet = template.addWorksheet('Plan1');
  sheet.addRow(['COD_EQUIPAMENTO','DATAMOVIMENTO','PESOBRUTO','OBSERVACAO']);
  sheet.addRow(['OLD-EQUIPMENT',new Date('2026-10-01T00:00:00Z'),99,'old source']);
  sheet.addRow(['STALE-ROW','stale','stale','stale']);
  sheet.getCell('B2').numFmt='dd/mm/yyyy';
  sheet.getColumn('A').width = 32;
  template.addWorksheet('Instrucoes').getCell('A1').value = 'Modelo original';
  const base64 = Buffer.from(await template.xlsx.writeBuffer()).toString('base64');
  const bytes = await createImportWorkbook({
    document:{sourceName:'colheita.pdf',profileSnapshot:{templateBase64:base64}},sheetName:'Plan1',startRow:2,
    columns:[{key:'COD_EQUIPAMENTO',column:'A',type:'text',label:'Código'},{key:'DATAMOVIMENTO',column:'B',type:'date',label:'Data'},
      {key:'PESOBRUTO',column:'C',type:'decimal',label:'Peso'},{key:'OBSERVACAO',column:'D',type:'text',label:'Obs'}],
    rows:[{entryId:'one',values:{A:'0006269',B:'2026-10-22',C:'61.310',D:'=HYPERLINK("example.com")'}}],
  });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes.buffer);
  const exported = workbook.getWorksheet('Plan1');
  assert.equal(exported.getCell('A1').value,'COD_EQUIPAMENTO');
  assert.equal(exported.getCell('A2').value,'0006269');
  assert.equal(exported.getCell('A2').type,ExcelJS.ValueType.String);
  assert.equal(exported.getCell('A2').numFmt,'@');
  assert.ok(exported.getCell('B2').value instanceof Date);
  assert.equal(exported.getCell('B2').value.toISOString(),'2026-10-22T00:00:00.000Z');
  assert.equal(exported.getCell('B2').numFmt,'dd/mm/yyyy');
  assert.equal(exported.getCell('C2').type,ExcelJS.ValueType.Number);
  assert.equal(exported.getCell('C2').value,61.31);
  assert.equal(exported.getCell('D2').type,ExcelJS.ValueType.String);
  assert.equal(exported.getCell('D2').value,'=HYPERLINK("example.com")');
  assert.equal(exported.getCell('A3').value,null);
  assert.equal(exported.getColumn('A').width,32);
  assert.equal(workbook.getWorksheet('Instrucoes').getCell('A1').value,'Modelo original');
});

test('inspects Excel columns and semantic types without importing operational sample values',async()=>{
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Dados');
  sheet.addRow(['COD_EQUIPAMENTO','DATAMOVIMENTO','PESOBRUTO']);
  sheet.addRow([6269,new Date('2026-10-22T00:00:00Z'),61.31]);
  sheet.getCell('B2').numFmt='dd/mm/yyyy';
  const file = new File([await workbook.xlsx.writeBuffer()],'modelo.xlsx');
  const result = await inspectWorkbookTemplate(file);
  assert.equal(result.sheetName,'Dados');
  assert.equal(result.startRow,2);
  assert.deepEqual(result.fields.map(field=>field.type),['decimal','date','decimal']);
  assert.deepEqual(result.columnTypes.map(column=>column.inferredType),['decimal','date','decimal']);
  assert.ok(result.fields.every(field=>field.defaultValue===''));
  assert.ok(result.templateBase64.length);
});

test('rejects numeric precision loss without silently changing the configured column to text',async()=>{
  const payload = {
    document:{sourceName:'colheita.pdf',profileSnapshot:{}},sheetName:'Plan1',startRow:2,
    columns:[{key:'PESOBRUTO',column:'A',type:'decimal',label:'Peso bruto'}],
    rows:[{entryId:'one',values:{A:'123456789012345.1'}}],
  };
  await assert.rejects(()=>createImportWorkbook(payload),/Peso bruto em A2.*15 dígitos significativos.*permanece Número/);
  assert.equal(payload.columns[0].type,'decimal');
  payload.rows[0].values.A='123456789012345.000000';
  const bytes = await createImportWorkbook(payload);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes.buffer);
  assert.equal(workbook.getWorksheet('Plan1').getCell('A2').type,ExcelJS.ValueType.Number);
  assert.equal(workbook.getWorksheet('Plan1').getCell('A2').value,123456789012345);
});

test('identifies complete-column mixed data and exposes unknown empty columns instead of guessing from ERP names',async()=>{
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Dados');
  sheet.addRow(['COD_EQUIPAMENTO','DATASEMAMOSTRA','AREA','MISTO','TEXTO_FORMATADO','NUMERO_FORMATADO','DATA_FORMATADA','HORA']);
  sheet.addRow([6269,null,null,123]);
  sheet.getCell('D150').value='00123';
  sheet.getColumn('E').numFmt='@';
  sheet.getCell('F2').numFmt='#,##0.000';
  sheet.getCell('G3').numFmt='dd/mm/yyyy';
  sheet.getCell('H2').value=0.25; sheet.getCell('H2').numFmt='hh:mm';
  const inspected = await inspectWorkbookTemplate(new File([await workbook.xlsx.writeBuffer()],'mixed.xlsx'));
  const byColumn = Object.fromEntries(inspected.columnTypes.map(column=>[column.column,column]));
  assert.equal(byColumn.A.inferredType,'decimal');
  assert.equal(byColumn.B.inferredType,null);
  assert.equal(byColumn.C.inferredType,null);
  assert.equal(byColumn.D.inferredType,null);
  assert.equal(byColumn.D.mixed,true);
  assert.deepEqual(new Set(byColumn.D.observedTypes),new Set(['decimal','text']));
  assert.ok(byColumn.D.sampleRows.includes(150));
  assert.equal(byColumn.E.inferredType,'text');
  assert.equal(byColumn.F.inferredType,'decimal');
  assert.equal(byColumn.G.inferredType,'date');
  assert.equal(byColumn.H.inferredType,null);
  assert.equal(byColumn.H.mixed,true);
  assert.equal(inspected.warnings.length,2);
});

test('keeps compatible custom number/date/text formats and carries the column format to additional output rows',async()=>{
  const template = new ExcelJS.Workbook();
  const sheet = template.addWorksheet('Plan1');
  sheet.addRow(['CODIGO','PESO','DATA','DATA_LONGA','MOEDA','PERCENTUAL']);
  sheet.addRow(['00001',12.3,new Date('2026-10-01T00:00:00Z'),new Date('2026-10-01T00:00:00Z'),12.3,0.25]);
  sheet.getCell('A2').numFmt='[Blue]@';
  sheet.getCell('B2').numFmt='#,##0.000';
  sheet.getCell('C2').numFmt='dd-mm-yyyy';
  sheet.getCell('D2').numFmt='dddd, mmmm d, yyyy';
  sheet.getCell('E2').numFmt='"R$" #,##0.00;[Red]-"R$" #,##0.00';
  sheet.getCell('F2').numFmt='0.00%';
  const base64 = Buffer.from(await template.xlsx.writeBuffer()).toString('base64');
  const columns = ['text','decimal','date','date','decimal','decimal'].map((type,index)=>({key:`FIELD_${index}`,column:String.fromCharCode(65+index),type,label:`Campo ${index}`}));
  const values = {A:'0006269',B:'61.310',C:'2026-10-22',D:'2026-10-22',E:'1028.40',F:'0.125'};
  const bytes = await createImportWorkbook({document:{profileSnapshot:{templateBase64:base64}},sheetName:'Plan1',startRow:2,columns,rows:[{entryId:'one',values},{entryId:'two',values}]});
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes.buffer);
  const actual = workbook.getWorksheet('Plan1');
  for (const column of ['A','B','C','D','E','F']) {
    assert.equal(actual.getCell(`${column}2`).numFmt,sheet.getCell(`${column}2`).numFmt);
    assert.equal(actual.getCell(`${column}3`).numFmt,sheet.getCell(`${column}2`).numFmt);
  }
  assert.equal(actual.getCell('A3').value,'0006269');
  assert.equal(actual.getCell('B3').type,ExcelJS.ValueType.Number);
  assert.ok(actual.getCell('C3').value instanceof Date);
});

test('does not let incompatible old number formats override an explicitly configured new type',async()=>{
  const template = new ExcelJS.Workbook();
  const sheet=template.addWorksheet('Plan1'); sheet.addRow(['TEXTO','NUMERO','DATA']);
  sheet.addRow([123,'123','2026-10-22']);
  sheet.getCell('A2').numFmt='000000'; sheet.getCell('B2').numFmt='@'; sheet.getCell('C2').numFmt='@';
  const base64=Buffer.from(await template.xlsx.writeBuffer()).toString('base64');
  const bytes=await createImportWorkbook({document:{profileSnapshot:{templateBase64:base64}},sheetName:'Plan1',startRow:2,
    columns:[{key:'TEXTO',column:'A',type:'text'},{key:'NUMERO',column:'B',type:'decimal'},{key:'DATA',column:'C',type:'date'}],
    rows:[{entryId:'one',values:{A:'00123',B:'123.4',C:'2026-10-22'}}]});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes.buffer);const actual=workbook.getWorksheet('Plan1');
  assert.equal(actual.getCell('A2').type,ExcelJS.ValueType.String);assert.equal(actual.getCell('A2').numFmt,'@');
  assert.equal(actual.getCell('B2').type,ExcelJS.ValueType.Number);assert.notEqual(actual.getCell('B2').numFmt,'@');
  assert.ok(actual.getCell('C2').value instanceof Date);assert.equal(actual.getCell('C2').numFmt,'dd/mm/yyyy');
});

test('preserves native numeric General format in the template and additional rows without changing text IDs or dates',async()=>{
  const template=new ExcelJS.Workbook();const sheet=template.addWorksheet('Plan1');
  sheet.addRow(['NUMERO','ID_TEXTO','DATA','PESO']);
  sheet.addRow([6269,'0006269',new Date('2026-10-22T00:00:00Z'),61.31]);
  sheet.getCell('A2').numFmt='General';sheet.getCell('B2').numFmt='@';sheet.getCell('C2').numFmt='dd/mm/yyyy';sheet.getCell('D2').numFmt='#,##0.000';
  const templateBase64=Buffer.from(await template.xlsx.writeBuffer()).toString('base64');
  const values={A:'6269',B:'0006269',C:'2026-10-22',D:'61.310'};
  const bytes=await createImportWorkbook({document:{profileSnapshot:{templateBase64}},sheetName:'Plan1',startRow:2,
    columns:[{key:'NUMERO',column:'A',type:'decimal'},{key:'ID_TEXTO',column:'B',type:'text'},{key:'DATA',column:'C',type:'date'},{key:'PESO',column:'D',type:'decimal'}],
    rows:[{entryId:'one',values},{entryId:'two',values}]});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes.buffer);const actual=workbook.getWorksheet('Plan1');
  for(const row of [2,3]){
    assert.equal(actual.getCell(`A${row}`).type,ExcelJS.ValueType.Number);
    assert.equal(actual.getCell(`A${row}`).value,6269);
    assert.equal(actual.getCell(`A${row}`).numFmt||'General','General');
    assert.equal(actual.getCell(`B${row}`).type,ExcelJS.ValueType.String);
    assert.equal(actual.getCell(`B${row}`).value,'0006269');
    assert.equal(actual.getCell(`B${row}`).numFmt,'@');
    assert.ok(actual.getCell(`C${row}`).value instanceof Date);
    assert.equal(actual.getCell(`C${row}`).numFmt,'dd/mm/yyyy');
    assert.equal(actual.getCell(`D${row}`).type,ExcelJS.ValueType.Number);
    assert.equal(actual.getCell(`D${row}`).numFmt,'#,##0.000');
  }
});

test('blank cells keep explicit template column formats beyond the original rows without becoming zero or text',async()=>{
 const template=new ExcelJS.Workbook(),sheet=template.addWorksheet('Plan1');
 sheet.addRow(['CODIGO','PESO','DATA','NUMERO','SEM_EVIDENCIA']);
 sheet.addRow(['000123',12.345,new Date('2026-10-24T00:00:00Z'),806,null]);
 const formats=['@','#,##0.000','mm-dd-yy','General','General'];
 formats.forEach((format,index)=>{sheet.getRow(2).getCell(index+1).numFmt=format;});
 sheet.getCell('A2').font={name:'Arial',size:14,color:{argb:'FF102030'}};sheet.getCell('A2').alignment={horizontal:'center'};
 sheet.getCell('B2').alignment={shrinkToFit:true};sheet.getCell('B2').border={bottom:{style:'thin',color:{argb:'FF222222'}}};
 const templateBase64=Buffer.from(await template.xlsx.writeBuffer()).toString('base64');
 const bytes=await createImportWorkbook({document:{profileSnapshot:{templateBase64}},sheetName:'Plan1',startRow:2,
  columns:['text','decimal','date','decimal','text'].map((type,index)=>({key:`FIELD_${index}`,column:String.fromCharCode(65+index),type})),
  rows:[{entryId:'sample',values:{A:'000123',B:'12.345',C:'2026-10-24',D:'806',E:''}},{entryId:'blank',values:{A:'',B:'',C:'',D:'',E:''}}]});
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes.buffer);const actual=workbook.getWorksheet('Plan1');
 for(const row of [2,3])for(let col=1;col<=5;col++)assert.equal(actual.getRow(row).getCell(col).numFmt??'General',formats[col-1]);
 for(let col=1;col<=5;col++){assert.equal(actual.getRow(3).getCell(col).value,null);assert.equal(actual.getRow(3).getCell(col).type,ExcelJS.ValueType.Null);}
 for(let col=1;col<=5;col++)assert.deepEqual(actual.getRow(3).getCell(col).style,actual.getRow(2).getCell(col).style,'Blank new rows keep the sample cell font, alignment, borders and format');
 assert.equal(actual.getCell('A2').type,ExcelJS.ValueType.String);assert.equal(actual.getCell('A2').value,'000123');
 assert.equal(actual.getCell('B2').type,ExcelJS.ValueType.Number);assert.equal(actual.getCell('C2').type,ExcelJS.ValueType.Date);
});
