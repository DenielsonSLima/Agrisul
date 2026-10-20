import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));

const onePixelPng = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 1, 115, 82, 71, 66, 0, 174, 206, 28, 233, 0, 0, 0,
  13, 73, 68, 65, 84, 24, 87, 99, 96, 96, 96, 248, 15, 0, 1, 4,
  1, 0, 112, 32, 101, 11, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
  96, 130,
]);

async function withRenderer(run) {
  const directory = await mkdtemp(join(tmpdir(), 'agrisul-mcp-pdf-'));
  try {
    const outfile = join(directory, 'quote-pdf.mjs');
    await build({
      entryPoints: ['modules/mcp/quotePdf.ts'],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const {createMcpQuotationPdf} = await import(pathToFileURL(outfile).href);
    await run(createMcpQuotationPdf);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

function sampleQuote(items) {
  return {
    title: 'Cotacao de pecas',
    number: 'COT-TEST-001',
    requestDate: '2026-10-05',
    requester: 'SOLICITANTE TESTE',
    notes: 'ENTREGA SOB CONSULTA',
    items,
  };
}

test('MCP quotation PDF works in Node with no supplier and with a validated item photo', async () => {
  await withRenderer(async createMcpQuotationPdf => {
    assert.equal(typeof globalThis.Image, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
    const quote = sampleQuote([{
      materialName: 'FILTRO DE OLEO',
      materialCode: 'MAT-TEST-001',
      quantity: '5',
      unit: 'PC',
      materialReferences: [{brand: 'MANN', code: 'H12111'}],
      image: {bytes: onePixelPng, format: 'PNG', width: 1, height: 1},
    }]);
    const imageCopy = Uint8Array.from(onePixelPng);

    const pdf = await createMcpQuotationPdf(quote, {companyName: 'EMPRESA TESTE'});
    await new Promise(resolve => setTimeout(resolve, 1100));
    const repeated = await createMcpQuotationPdf(quote, {companyName: 'EMPRESA TESTE'});
    assert.deepEqual(pdf, repeated, 'same quote snapshot must produce the same bytes for idempotent storage');
    assert.ok(pdf instanceof Uint8Array);
    assert.ok(pdf.byteLength > 2_000);
    assert.deepEqual(onePixelPng, imageCopy, 'renderer must not mutate supplied image bytes');

    const source = Buffer.from(pdf).toString('latin1');
    assert.match(source, /^%PDF-1\./);
    for (const text of ['EMPRESA TESTE', 'COT-TEST-001', 'SOLICITANTE TESTE', 'FILTRO DE OLEO', 'MAT-TEST-001', 'MANN H12111', '5 PC', 'ENTREGA SOB CONSULTA']) {
      assert.ok(source.includes(text), `PDF must contain ${text}`);
    }
    assert.match(source, /\/Subtype \/Image/, 'the item photo is embedded');
    assert.doesNotMatch(source, /FORNECEDOR|Fornecedor|SUPPLIER/, 'supplier must not be invented');
  });
});

test('MCP quotation PDF paginates a large fixture and keeps rendering with a damaged image', async () => {
  await withRenderer(async createMcpQuotationPdf => {
    const items = Array.from({length: 60}, (_, index) => ({
      materialName: `ITEM TESTE ${String(index + 1).padStart(2, '0')}`,
      materialCode: `MAT-${String(index + 1).padStart(3, '0')}`,
      quantity: String(index + 1),
      unit: 'UN',
      image: index === 0 ? {bytes: Uint8Array.of(1, 2, 3), format: 'PNG', width: 1, height: 1} : undefined,
    }));
    const pdf = await createMcpQuotationPdf(sampleQuote(items));
    const source = Buffer.from(pdf).toString('latin1');
    const pages = [...source.matchAll(/\/Type \/Page\b/g)].length;
    assert.ok(pages >= 3, `expected at least 3 pages, got ${pages}`);
    assert.ok(source.includes('ITEM TESTE 01'));
    assert.ok(source.includes('ITEM TESTE 60'));
    assert.ok(source.includes(`de ${pages}`), 'footer must report the final page count');
  });
});

test('one item with hundreds of references continues on new pages without losing its final code', async () => {
  await withRenderer(async createMcpQuotationPdf => {
    const references = Array.from({length: 600}, (_, index) => ({
      brand: `MARCA-${String(index).padStart(3, '0')}`,
      code: `REF-${String(index).padStart(3, '0')}`,
    }));
    const pdf = await createMcpQuotationPdf(sampleQuote([{
      materialName: 'PECA COM MUITAS REFERENCIAS', materialCode: 'MAT-MUITAS',
      quantity: '1', unit: 'UN', materialReferences: references,
    }]));
    const source = Buffer.from(pdf).toString('latin1');
    const pages = [...source.matchAll(/\/Type \/Page\b/g)].length;
    assert.ok(pages >= 3, `a single tall item must span pages; got ${pages}`);
    for (let index = 0; index < references.length; index += 1) {
      assert.ok(source.includes(`REF-${String(index).padStart(3, '0')}`), `reference ${index} must be retained`);
    }
    assert.ok(source.includes('cont.'), 'continued cards must be identified');
    assert.ok(source.includes(`de ${pages}`), 'the footer must use the final page count');
  });
});
