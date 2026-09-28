import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));
const reportUrl = new URL('../modules/cotacao/reporting/quotationNegotiationPdf.ts', import.meta.url);
const tabUrl = new URL('../modules/cotacao/components/QuoteNegotiationTab.tsx', import.meta.url);

function item(id, materialId, name) {
  return {
    id, materialId, materialVariantId: null, materialName: name, materialCode: '',
    materialApplication: '', materialReferences: [], quantity: '2', unit: 'UN', notes: '',
  };
}

function provider(id, name, itemId, offer) {
  return {
    id, providerId: `catalog-${id}`, providerName: name, values: {[itemId]: offer.unitPrice},
    offers: {[itemId]: offer}, notes: '', sentAt: null,
    grossTotal: offer.lineSubtotal, total: offer.lineTotal, quotedItemCount: 1,
    awardedItemCount: id === 'supplier-a' ? 1 : 0,
    awardedGrossTotal: id === 'supplier-a' ? offer.lineSubtotal : '0',
    awardedTotal: id === 'supplier-a' ? offer.lineTotal : '0',
  };
}

async function compileReport(directory) {
  const outfile = join(directory, 'quotation-negotiation-pdf.mjs');
  await build({
    entryPoints: [resolve('modules/cotacao/reporting/quotationNegotiationPdf.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

test('negotiation PDF preserves every supplier, discount, award and server total in landscape', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quotation-negotiation-pdf-'));
  try {
    const {createQuotationNegotiationSnapshot, createQuotationNegotiationPdf} = await compileReport(directory);
    const quoteItem = item('item-a', 'material-a', 'Luva de segurança');
    const discounted = {
      unitPrice: '10.00', discountType: 'percentage', discountValue: '7.00',
      lineSubtotal: '20.00', discountAmount: '1.40', lineTotal: '18.60', netUnitPrice: '9.30',
    };
    const regular = {
      unitPrice: '12.00', discountType: 'none', discountValue: '0',
      lineSubtotal: '24.00', discountAmount: '0', lineTotal: '24.00', netUnitPrice: '12.00',
    };
    const supplierA = provider('supplier-a', 'Fornecedor Alfa', quoteItem.id, discounted);
    const supplierB = provider('supplier-b', 'Fornecedor Beta', quoteItem.id, regular);
    const quote = {
      id: 'quote', title: 'Cotação de EPIs', number: 'COT-003', requestDate: '2026-09-23',
      requester: 'Edmilson', notes: '', createdAt: '', status: 'open', items: [quoteItem],
      providers: [supplierA, supplierB], negotiations: [],
      itemAwards: [{
        itemId: quoteItem.id, providerId: supplierA.id, unitPrice: '10.00',
        discountType: 'percentage', discountValue: '7.00', lineSubtotal: '20.00',
        discountAmount: '1.40', lineTotal: '18.60', awardedAt: '', updatedAt: '',
      }],
      awardedItemCount: 1, awardedGrossTotal: '20.00', awardedTotal: '18.60',
      completeProviderCount: 2, pendingAwardCount: 0, awardComplete: true,
      winningProviderIds: [supplierA.id], purchaseOrders: [],
    };
    const before = JSON.stringify(quote);
    const snapshot = createQuotationNegotiationSnapshot(
      quote,
      new Map([[quoteItem.materialId, null]]),
    );

    assert.equal(JSON.stringify(quote), before, 'snapshot creation must not mutate the quotation');
    assert.deepEqual(snapshot.providers.map(entry => entry.providerName), ['Fornecedor Alfa', 'Fornecedor Beta']);
    assert.equal(snapshot.providers[0].offers[quoteItem.id].netUnitPrice, '9.30');
    assert.equal(snapshot.providers[0].grossTotal, '20.00');
    assert.equal(snapshot.providers[0].total, '18.60');
    assert.equal(snapshot.approvedProviderByItem[quoteItem.id], supplierA.id);
    assert.equal(snapshot.awardedGrossTotal, '20.00');
    assert.equal(snapshot.awardedTotal, '18.60');

    const result = await createQuotationNegotiationPdf(snapshot, {
      company: null,
      header: {variant: 'compact', logoAlignment: 'left', showCnpj: true, showContact: true},
      watermark: {imageUrl: null, opacity: 15, size: 60},
      issuer: {id: 'tester', name: 'Teste', email: ''},
      issuedAt: new Date('2026-09-23T12:00:00-03:00'),
    });
    assert.equal(
      result.fileName,
      'negociacao-fornecedor-alfa-fornecedor-beta-cotacao-de-epis-cot-003.pdf',
    );
    assert.ok(result.doc.internal.pageSize.getWidth() > result.doc.internal.pageSize.getHeight());
    assert.equal(
      new TextDecoder().decode(new Uint8Array(result.doc.output('arraybuffer')).slice(0, 4)),
      '%PDF',
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('landscape negotiation PDF fits eight material rows on full pages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quotation-negotiation-density-'));
  try {
    const {createQuotationNegotiationPdf} = await compileReport(directory);
    const items = Array.from({length: 26}, (_, index) => ({
      ...item(`item-${index + 1}`, `material-${index + 1}`, `Equipamento de proteção individual ${index + 1}`),
      materialImageUrl: null,
    }));
    const offer = {
      unitPrice: '69.70', discountType: 'percentage', discountValue: '7.00',
      lineSubtotal: '139.40', discountAmount: '9.76', lineTotal: '129.64', netUnitPrice: '64.82',
    };
    const providers = Array.from({length: 3}, (_, index) => ({
      id: `supplier-${index + 1}`,
      providerId: `catalog-supplier-${index + 1}`,
      providerName: `Fornecedor de equipamentos industriais ${index + 1}`,
      values: Object.fromEntries(items.map(entry => [entry.id, offer.unitPrice])),
      offers: Object.fromEntries(items.map(entry => [entry.id, {...offer}])),
      notes: '', sentAt: null,
      grossTotal: '3624.40', total: '3370.64', quotedItemCount: items.length,
      awardedItemCount: index === 0 ? items.length : 0,
      awardedGrossTotal: index === 0 ? '3624.40' : '0',
      awardedTotal: index === 0 ? '3370.64' : '0',
    }));
    const result = await createQuotationNegotiationPdf({
      title: 'Cotação de EPIs - 23/09/2026',
      number: 'COT-003',
      requestDate: '2026-09-23',
      requester: 'Edmilson',
      items,
      providers,
      approvedProviderByItem: Object.fromEntries(items.map(entry => [entry.id, providers[0].id])),
      awardedItemCount: items.length,
      awardedGrossTotal: '3624.40',
      awardedTotal: '3370.64',
    }, {
      company: {
        id: 'company', name: 'AGRISUL AGRÍCOLA LTDA EM RECUPERAÇÃO JUDICIAL', legalName: '',
        cnpj: '04.773.159/0005-23', phone: '(11) 3262-1428', email: 'gerenciacontabil@best.com.br',
        street: 'Fazenda Santana', number: 'S/N', complement: '', district: 'Zona Rural',
        city: 'Itaporanga', state: 'SE', zipCode: '49950-000', logoUrl: null,
      },
      header: {variant: 'detailed', logoAlignment: 'left', showCnpj: true, showContact: true},
      watermark: {imageUrl: null, opacity: 15, size: 60},
      issuer: {id: 'tester', name: 'Teste', email: ''},
      issuedAt: new Date('2026-09-23T12:00:00-03:00'),
    });

    assert.equal(result.doc.getNumberOfPages(), 4, '26 materials should use three full eight-row pages plus the final page');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('negotiation tab exposes the complete landscape report with preview and download', async () => {
  const [report, tab] = await Promise.all([readFile(reportUrl, 'utf8'), readFile(tabUrl, 'utf8')]);

  assert.match(report, /orientation:\s*'landscape'/);
  assert.match(report, /snapshot\.providers\.length/);
  assert.match(report, /snapshot\.items\.forEach/);
  assert.match(report, /approvedProviderByItem/);
  assert.match(report, /APROVADO/);
  assert.match(report, /Valor total/);
  assert.match(report, /Total com desconto/);
  assert.match(report, /Valor aprovado/);
  assert.match(report, /Aprovado com desconto/);
  assert.doesNotMatch(report, /Number\([^)]*unitPrice/);
  assert.match(tab, />Exportar PDF</);
  assert.match(tab, /createQuotationNegotiationSnapshot/);
  assert.match(tab, /createPdf=\{createQuotationNegotiationPdf\}/);
  assert.match(tab, /orientation="landscape"/);
  assert.match(tab, /showPreviewToolbar/);
});
