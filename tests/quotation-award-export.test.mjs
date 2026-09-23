import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));
const reportUrl = new URL('../modules/cotacao/reporting/quotationAwardPdf.ts', import.meta.url);
const summaryUrl = new URL('../modules/cotacao/components/QuoteSummaryTab.tsx', import.meta.url);
const providersUrl = new URL('../modules/cotacao/components/QuoteProvidersTab.tsx', import.meta.url);

test('approved export snapshot contains only items awarded to its supplier and trusts server totals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quotation-award-export-'));
  try {
    const outfile = join(directory, 'quotation-award-export.mjs');
    await build({
      entryPoints: [resolve('modules/cotacao/reporting/quotationAwardPdf.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const {createQuotationAwardSnapshot, createQuotationAwardPdf} = await import(pathToFileURL(outfile).href);
    const providerA = {
      id: 'quote-provider-a', providerId: 'provider-a', providerName: 'Fornecedor A',
      providerDocumentType: 'CNPJ', providerDocument: '04773159000523', values: {'item-a': '12.34'},
      notes: '', sentAt: null, awardedItemCount: 1, awardedTotal: '61.70',
    };
    const providerB = {...providerA, id: 'quote-provider-b', providerId: 'provider-b', providerName: 'Fornecedor B'};
    const item = (id, materialId, name) => ({
      id, materialId, materialVariantId: null, materialName: name, materialCode: '',
      materialApplication: '', materialReferences: [], quantity: '5', unit: 'PC', notes: '',
    });
    const quote = {
      id: 'quote', title: 'Cotação de filtros', number: 'COT-010', requestDate: '2026-09-23',
      requester: 'Solicitante', notes: '', createdAt: '', status: 'open',
      items: [item('item-a', 'material-a', 'Filtro A'), item('item-b', 'material-b', 'Filtro B')],
      providers: [providerA, providerB], negotiations: [],
      itemAwards: [
        {itemId: 'item-a', providerId: providerA.id, unitPrice: '12.34', lineTotal: '61.70', awardedAt: '', updatedAt: ''},
        {itemId: 'item-b', providerId: providerB.id, unitPrice: '20.00', lineTotal: '100.00', awardedAt: '', updatedAt: ''},
      ],
      awardedItemCount: 2, awardComplete: true, winningProviderIds: [], purchaseOrders: [],
    };
    const before = JSON.stringify(quote);
    const snapshot = createQuotationAwardSnapshot(
      quote,
      providerA,
      new Map([['material-a', null], ['material-b', 'must-not-be-loaded']]),
    );

    assert.equal(JSON.stringify(quote), before, 'snapshot creation must not mutate the quotation');
    assert.deepEqual(snapshot.items.map(item => item.id), ['item-a']);
    assert.equal(snapshot.items[0].unitPrice, '12.34');
    assert.equal(snapshot.items[0].lineTotal, '61.70');
    assert.equal(snapshot.total, '61.70', 'supplier total must come from the server projection');

    const result = await createQuotationAwardPdf(snapshot, {
      company: null,
      header: {variant: 'compact', logoAlignment: 'left', showCnpj: true, showContact: true},
      watermark: {imageUrl: null, opacity: 15, size: 60},
      issuer: {id: 'tester', name: 'Teste', email: ''},
      issuedAt: new Date('2026-09-23T12:00:00-03:00'),
    });
    assert.equal(result.fileName, 'cotacao-aprovada-cot-010-fornecedor-a.pdf');
    assert.equal(
      new TextDecoder().decode(new Uint8Array(result.doc.output('arraybuffer')).slice(0, 4)),
      '%PDF',
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('summary exports per-supplier awards and suppliers tab exposes incremental inclusion', async () => {
  const [report, summary, providers] = await Promise.all([
    readFile(reportUrl, 'utf8'),
    readFile(summaryUrl, 'utf8'),
    readFile(providersUrl, 'utf8'),
  ]);

  assert.match(report, /quote\.itemAwards[\s\S]*?award\.providerId\s*===\s*provider\.id/);
  assert.match(report, /unitPrice:\s*award\.unitPrice/);
  assert.match(report, /lineTotal:\s*award\.lineTotal/);
  assert.doesNotMatch(report, /Number\(item\.quantity\)[\s\S]{0,80}Number\(item\.unitPrice\)/);
  assert.match(summary, /Itens aprovados/);
  assert.match(summary, /Total aprovado/);
  assert.match(summary, /<QuoteAwardExportDialog/);
  assert.match(summary, /\[exportProviderId,\s*setExportProviderId\]\s*=\s*useState<string\s*\|\s*null>/);
  assert.match(summary, /quote\.providers\.find\(provider\s*=>\s*provider\.id\s*===\s*exportProviderId\)/);
  assert.match(summary, /onClick=\{\(\)\s*=>\s*setExportProviderId\(provider\.id\)\}/);
  assert.match(summary, /aria-label=\{`Exportar itens aprovados para \$\{provider\.providerName\}`\}/);
  assert.match(providers, /onAddProviders\?:\s*\(\)\s*=>\s*void/);
  assert.match(providers, /Adicionar fornecedor/);
  assert.match(providers, /onClick=\{onAddProviders\}/);
  assert.match(providers, /provider\.awardedItemCount/);
  assert.match(providers, /Pedido gerado/);
});
