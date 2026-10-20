import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createWeighingXlsx} from './weighingXlsx.ts';

const require = createRequire(import.meta.url), {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));
const directory = await mkdtemp(join(tmpdir(), 'weighing-export-'));
const summary = {entryCount: 45, completeCount: 44, pendingCount: 1, tareKg: '600000.123456', grossKg: '1383230.123456', agrisulNetKg: '783230', partnerNetKg: '737700', differenceKg: null, differencePercent: null};
const entries = Array.from({length: 45}, (_, index) => ({id: `entry-${index}`, controlId: 'control', weighedAt: '2026-10-18', weighedTime: '23:00', ticket: '=SUM(A1:A9)', notes: index === 44 ? 'ULTIMA_VIAGEM_PENDENTE' : '', trailerGrossMode: 'combined', combinedTrailerGrossKg: '55000', tareKg: '37040.123456', grossKg: '93860', agrisulNetKg: '57040', partnerNetKg: index === 44 ? null : '56460', partnerComplete: index !== 44, differenceKg: index === 44 ? null : '-580', differencePercent: index === 44 ? null : '-1.01683', components: [
  {fleetNumber: `T${index}`, plate: 'ABC1D23', kind: 'truck', tareKg: '16400.123456', grossKg: '38860', netKg: '22459.876544', partnerNetKg: index === 44 ? null : '22710', differenceKg: index === 44 ? null : '250.123456'},
  {fleetNumber: `R${index}A`, plate: 'DEF4G56', kind: 'trailer', tareKg: '10320', grossKg: '27500', netKg: '17180', partnerNetKg: index === 44 ? null : '16875', differenceKg: index === 44 ? null : '-305'},
  {fleetNumber: `R${index}B`, plate: '', kind: 'trailer', tareKg: null, grossKg: '27500', netKg: null, partnerNetKg: index === 44 ? null : '16875', differenceKg: null},
]}));
const detail = {control: {id: 'control', companyId: 'company', partnerId: 'partner', partnerName: 'TAQUARI & TESTE', season: '2026/2027', startDate: '2026-10-16', notes: 'FONTE_45_VIAGENS_11_FOTOS', summary}, entries, daily: [{date: '2026-10-18', ...summary}], summary, canManage: true};
try {
  const before = JSON.stringify(detail), bytes = createWeighingXlsx(detail);
  assert.equal(JSON.stringify(detail), before);
  assert.equal(Buffer.from(bytes).readUInt32LE(0), 0x04034b50);
  const xlsx = join(directory, 'weighing.xlsx'); await writeFile(xlsx, bytes);
  // Use .NET's independent ZIP/XML readers to verify actual XLSX package integrity.
  const verification = String.raw`
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($args[0])
try {
  function ReadXml($path) {
    $reader = [IO.StreamReader]::new($archive.GetEntry($path).Open())
    try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
  }
  $workbook = ReadXml 'xl/workbook.xml'
  if ($workbook.workbook.sheets.sheet.Count -ne 3) { throw 'Expected Summary, Comparative, Daily sheets' }
  $sheet = ReadXml 'xl/worksheets/sheet2.xml'
  $data = $sheet.worksheet.sheetData.row
  if ($data.Count -ne 186) { throw "Missing vehicle or subtotal rows: $($data.Count)" }
  if ($data[5].c[2].t -ne 'inlineStr') { throw 'Ticket is not stored as text' }
  if ($data[5].c[6].v -ne '16400.123456') { throw 'Decimal precision changed' }
  if ($data[8].c[6].v -ne '37040.123456') { throw 'Trip tare subtotal missing' }
  if ($data[6].c[3].is.t.InnerText -ne 'R0A') { throw 'Trailer fleet number missing' }
  if ($data[183].c[3].is.t.InnerText -ne 'R44B') { throw 'Last trailer missing' }
  if ($data[185].c[10].v) { throw 'Pending total was converted into zero' }
  foreach ($entry in $archive.Entries) { if ($entry.Name.EndsWith('.xml') -or $entry.Name.EndsWith('.rels')) { $null = ReadXml $entry.FullName } }
  'PASS: native ZIP/XML readers accept workbook, complete vehicles, decimals and pending totals'
} finally { $archive.Dispose() }
`;
  const script = join(directory, 'validate.ps1'); await writeFile(script, verification);
  if (process.platform === 'win32') console.log(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, xlsx], {encoding: 'utf8'}).trim());
  const outfile = join(directory, 'weighing-pdf.mjs');
  await build({entryPoints: ['modules/pesagens/reporting/weighingPdf.ts'], outfile, bundle: true, platform: 'node', format: 'esm'});
  const {createWeighingPdf} = await import(pathToFileURL(outfile).href);
  const brand = {company: null, header: {variant: 'detailed', logoAlignment: 'left', showCnpj: true, showContact: true}, watermark: {imageUrl: null, opacity: 15, size: 60}, issuer: {id: 'user', name: 'TESTE_RELATORIO', email: ''}, issuedAt: new Date('2026-10-20T12:00:00Z')};
  const {doc, fileName} = await createWeighingPdf(detail, brand), text = doc.internal.pages.slice(1).flat().join('\n');
  assert.equal(JSON.stringify(detail), before, 'Exports preserve the authoritative server snapshot');
  assert.ok(Math.abs(doc.internal.pageSize.getWidth() - 297) < .1);
  assert.ok(doc.getNumberOfPages() >= 10, 'All 45 complete trips must paginate without clipping');
  for (const sentinel of ['FONTE_45_VIAGENS_11_FOTOS', 'parcial', 'R44A', 'R44B', 'ULTIMA_VIAGEM_PENDENTE', 'Pendente', '783.230', '737.700', 'TESTE_RELATORIO']) assert.ok(text.includes(sentinel), `Missing PDF content: ${sentinel}`);
  assert.equal(fileName, 'pesagem-cana-2026-10-16.pdf');
  assert.ok(doc.output().startsWith('%PDF-'));
  console.log('PASS: complete A4 landscape PDF, last trip, fleet IDs, missing plates, official partial totals and multi-page rendering');
} finally {
  if (!resolve(directory).startsWith(join(resolve(tmpdir()), 'weighing-export-'))) throw Error('Unsafe test cleanup path');
  await rm(directory, {recursive: true, force: true});
}
