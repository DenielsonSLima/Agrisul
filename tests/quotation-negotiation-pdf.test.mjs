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

async function compileReport(directory, plugins = []) {
  const outfile = join(directory, 'quotation-negotiation-pdf.mjs');
  await build({
    entryPoints: [resolve('modules/cotacao/reporting/quotationNegotiationPdf.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins,
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

test('five photographed materials retain one map page followed by the closing summary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quotation-negotiation-single-page-'));
  try {
    const {createQuotationNegotiationPdf} = await compileReport(directory, [{
      name: 'negotiation-photo-fixture',
      setup(builder) {
        builder.onResolve({filter: /^@\/shared\/reporting\/loadReportImage$/}, () => ({path: 'image', namespace: 'negotiation-test'}));
        builder.onLoad({filter: /^image$/, namespace: 'negotiation-test'}, () => ({loader: 'js', contents: `
          export async function loadReportImage(url) {
            if (!url) return null;
            return {bytes: Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64')), ratio: 1, format: 'PNG'};
          }
        `}));
      },
    }]);
    const items = Array.from({length: 5}, (_, index) => ({
      ...item(`item-${index}`, `material-${index}`, `Material identificado ${index + 1}`),
      materialImageUrl: `fixture://material-${index}`,
    }));
    const offer = {unitPrice: '10', availableQuantity: '2', discountType: 'percentage', discountValue: '10', lineSubtotal: '20', discountAmount: '2', lineTotal: '18', netUnitPrice: '9'};
    const supplier = {
      ...provider('supplier-a', 'Fornecedor de peças agrícolas', items[0].id, offer),
      values: Object.fromEntries(items.map(item => [item.id, offer.unitPrice])),
      offers: Object.fromEntries(items.map(item => [item.id, {...offer}])),
      grossTotal: '100', total: '90', awardedGrossTotal: '100', awardedTotal: '90', awardedItemCount: 5,
    };
    const snapshot = {
      title: 'Solicitação de compra nº 435 — Carregadeira Valtra BM100 nº 220',
      number: '435', requestDate: '2026-11-16', requester: 'Edmilson', items, providers: [supplier],
      approvedProviderByItem: Object.fromEntries(items.map(item => [item.id, supplier.id])),
      awardedItemCount: 5, awardedGrossTotal: '100', awardedTotal: '90',
    };
    const before = JSON.stringify(snapshot);
    const result = await createQuotationNegotiationPdf(snapshot, {
      company: {
        id: 'company', name: 'EMPRESA AGRICOLA LTDA EM RECUPERACAO JUDICIAL', legalName: '',
        cnpj: '12345678000195', phone: '(79) 3333-2222', email: 'compras@empresa.example',
        street: 'Fazenda Santa Ana', number: 'S/N', complement: '', district: 'Zona Rural',
        city: 'Japoatã', state: 'SE', zipCode: '49950000', logoUrl: null,
      },
      header: {variant: 'detailed', logoAlignment: 'left', showCnpj: true, showContact: true},
      watermark: {imageUrl: null, opacity: 100, size: 100},
      issuer: {id: 'tester', name: 'Teste PDF', email: ''}, issuedAt: new Date('2026-11-16T12:00:00-03:00'),
    });
    assert.equal(result.doc.getNumberOfPages(), 2, 'the five-row map keeps its totals and gains one closing page');
    assert.equal(JSON.stringify(snapshot), before, 'export must preserve all server prices and approvals');
    const {getDocument, OPS} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({data: new Uint8Array(result.doc.output('arraybuffer')), useSystemFonts: true});
    try {
      const pdf = await loading.promise, page = await pdf.getPage(1);
      const {items: textItems} = await page.getTextContent();
      const text = textItems.map(item => item.str).join(' ').replace(/\s+/g, ' ');
      for (const value of ['Material identificado 1', 'Material identificado 5', 'TOTAIS POR FORNECEDOR', 'Total com desconto', 'Valor aprovado', 'Total aprovado com desconto', 'VALOR GERAL APROVADO', 'VALOR GERAL APROVADO COM DESCONTO', '5 de 5 itens aprovados', '100,00', '90,00', '1 / 2']) {
        assert.ok(text.includes(value), `missing ${value}`);
      }
      const operators = await page.getOperatorList();
      assert.equal(operators.fnArray.filter(operator => operator === OPS.paintImageXObject).length, 5, 'all five photos must remain in the PDF');
      const footer = textItems.find(item => item.str.startsWith('Emitido por'));
      assert.ok(footer);
      const total = textItems.find(item => item.str === 'VALOR GERAL APROVADO');
      assert.ok(total.transform[5] > footer.transform[5] + 25, 'general totals must leave room above the footer');
    } finally {
      await loading.destroy();
    }
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

    assert.equal(result.doc.getNumberOfPages(), 5, '26 materials keep four map pages and add one closing page');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('closing page includes every supplier, supplied conditions, server totals and a blank signature line', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quotation-closing-summary-'));
  try {
    const {createQuotationNegotiationPdf} = await compileReport(directory);
    const items = Array.from({length: 2}, (_, index) => ({...item(`item-${index}`, `material-${index}`, `Material ${index}`), materialImageUrl: null}));
    const offer = {unitPrice: '999', availableQuantity: '1', discountType: 'none', discountValue: '0', lineSubtotal: '999', discountAmount: '0', lineTotal: '999', netUnitPrice: '999'};
    const providers = [
      {...provider('supplier-a', 'Casa do Parafuso Vasconcelos', items[0].id, offer), quotedItemCount: 28, awardedItemCount: 15, awardedGrossTotal: '1100.10', awardedTotal: '1024.00'},
      {...provider('supplier-b', 'Marcio Guimaraes Monteiro', items[0].id, offer), quotedItemCount: 22, awardedItemCount: 2, awardedGrossTotal: '250.00', awardedTotal: '250.00'},
      {...provider('supplier-c', 'Fornecedor sem aprovacao', items[0].id, offer), quotedItemCount: 10, awardedItemCount: 0, awardedGrossTotal: '0', awardedTotal: '0'},
    ];
    const snapshot = {
      title: 'Ferramentas para oficina', number: 'COT-001', requestDate: '2026-11-18', requester: 'Edmilson',
      items, providers, approvedProviderByItem: {}, awardedItemCount: 17, awardedGrossTotal: '1350.10', awardedTotal: '1274.00',
      providerTerms: {'supplier-a': {paymentTerms: '30/60/90 dias', deliveryTime: '5 dias úteis após o pedido', proposalValidity: '30/11/2026'}},
      closingNotes: 'Entregar na oficina. Conferir os itens no recebimento.',
    };
    const before = JSON.stringify(snapshot);
    const result = await createQuotationNegotiationPdf(snapshot, {
      company: null, header: {variant: 'detailed', logoAlignment: 'left', showCnpj: true, showContact: true},
      watermark: {imageUrl: null, opacity: 15, size: 60}, issuer: {id: 'tester', name: 'Emissor de teste', email: ''},
      issuedAt: new Date('2026-11-18T12:00:00-03:00'),
    });
    assert.equal(JSON.stringify(snapshot), before);
    const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({data: new Uint8Array(result.doc.output('arraybuffer')), useSystemFonts: true});
    try {
      const pdf = await loading.promise;
      const page = await pdf.getPage(pdf.numPages);
      const {items: texts} = await page.getTextContent();
      const text = texts.map(entry => entry.str).join(' ').replace(/\s+/g, ' ');
      for (const value of ['Resumo da cotação', 'MATERIAIS NA COTAÇÃO', 'MATERIAIS APROVADOS', 'FORNECEDORES', 'Casa do Parafuso', 'Marcio Guimaraes', 'Fornecedor sem aprovacao', '1.100,10', '1.024,00', '250,00', '1.274,00', '30/60/90 dias', '5 dias úteis', '30/11/2026', 'Entregar na oficina.', 'Assinatura']) {
        assert.ok(text.includes(value), `closing page missing ${value}`);
      }
      assert.doesNotMatch(text, /999,00/, 'closing page must use server totals, without deriving values from offers');
      assert.doesNotMatch(text, /Assinatura do responsável|Nome do responsável/);
      assert.ok(text.includes('____________________'), 'blank commercial fields remain fillable by hand');
      const footer = texts.find(entry => entry.str.startsWith('Emitido por'));
      for (const entry of texts.filter(entry => entry.str.trim() && !entry.str.startsWith('Emitido por') && !/^\d+ \/ \d+$/.test(entry.str))) {
        assert.ok(entry.transform[5] > footer.transform[5] + 9, `text overlaps footer: ${entry.str}`);
      }
    } finally {
      await loading.destroy();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('closing summary paginates many suppliers and keeps full long conditions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quotation-closing-overflow-'));
  try {
    const {drawQuotationClosingSummary} = await (async () => {
      const outfile = join(directory, 'closing.mjs');
      await build({entryPoints: [resolve('modules/cotacao/reporting/quotationClosingSummary.ts')], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent'});
      return import(pathToFileURL(outfile).href);
    })();
    const {jsPDF} = await import('jspdf');
    const doc = new jsPDF({orientation: 'landscape', unit: 'mm', format: 'a4'});
    const providers = Array.from({length: 16}, (_, index) => ({id: `p-${index}`, providerName: `Fornecedor de ferramentas industriais com nome extenso número ${index + 1}`, quotedItemCount: 3, awardedItemCount: 1, awardedTotal: '123.45', awardedGrossTotal: '123.45'}));
    const deliveryTime = 'Entrega em até dez dias úteis após confirmação do pedido e agendamento com o responsável pelo recebimento na oficina.';
    drawQuotationClosingSummary(doc, {
      title: 'Conferência completa de todos os fornecedores', number: 'COT-099', requestDate: '2026-11-18', requester: 'Edmilson', items: [], providers,
      awardedItemCount: 16, awardedGrossTotal: '1975.20', awardedTotal: '1975.20', approvedProviderByItem: {},
      providerTerms: Object.fromEntries(providers.map(p => [p.id, {paymentTerms: '30/60/90 dias contados a partir do recebimento da nota fiscal e aceite dos materiais entregues na unidade.', proposalValidity: 'Válida até 30/11/2026, mediante confirmação do estoque antes da emissão do pedido.', deliveryTime}])),
      closingNotes: 'Observações de fechamento para todos os fornecedores. '.repeat(18),
    }, {company: null, header: {variant: 'detailed', logoAlignment: 'left', showCnpj: true, showContact: true}, watermark: {imageUrl: null, opacity: 15, size: 60}, issuer: {id: '', name: '', email: ''}, issuedAt: new Date()}, null, null);
    const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({data: new Uint8Array(doc.output('arraybuffer')), useSystemFonts: true});
    try {
      const pdf = await loading.promise;
      assert.ok(pdf.numPages > 3);
      let text = '';
      for (let pageNumber = 2; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const {items} = await page.getTextContent();
        for (const entry of items) assert.ok(entry.transform[5] > 19 * 72 / 25.4, `summary text too close to footer on page ${pageNumber}: ${entry.str}`);
        text += items.map(entry => entry.str).join(' ') + ' ';
      }
      text = text.replace(/\s+/g, ' ');
      for (let index = 1; index <= 16; index++) assert.ok(text.includes(`número ${index}`));
      assert.equal(text.match(/agendamento com o responsável/g)?.length, 16);
      assert.ok(text.endsWith('Assinatura '));
    } finally {await loading.destroy();}
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('screen data and all quotation PDFs order names in Portuguese without changing item prices or approvals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quotation-alphabetical-'));
  try {
    await build({
      entryPoints: {
        api: resolve('modules/cotacao/services/quoteApi.ts'),
        negotiation: resolve('modules/cotacao/reporting/quotationNegotiationPdf.ts'),
        request: resolve('modules/cotacao/reporting/quotationRequestPdf.ts'),
        award: resolve('modules/cotacao/reporting/quotationAwardPdf.ts'),
      },
      outdir: directory, outExtension: {'.js': '.mjs'}, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
      plugins: [{name: 'quotation-screen-rpc', setup(builder) {
        builder.onResolve({filter: /^@\/shared\/supabase\/(rpc|client|workspace)$/}, args => ({path: args.path, namespace: 'quotation-order'}));
        builder.onLoad({filter: /.*/, namespace: 'quotation-order'}, args => ({loader: 'js', contents:
          args.path.endsWith('/rpc') ? 'export class RpcError extends Error{}; export async function rpcRequest(){return {quote:globalThis.__alphabeticalQuote}};' :
            args.path.endsWith('/client') ? 'export const getSupabaseBrowserClient=()=>{throw new Error("Unexpected storage request")};' :
              'export const fetchWorkspaceId=()=>{throw new Error("Unexpected workspace request")};',
        }));
      }}],
    });
    await build({
      entryPoints: [resolve('modules/cotacao/components/QuoteComparisonTab.tsx')], outfile: join(directory, 'comparison.cjs'),
      bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
      plugins: [{name: 'shared-react-instance', setup(builder) {
        builder.onResolve({filter: /^react(?:\/.*)?$/}, args => ({path: require.resolve(args.path), external: true}));
      }}],
    });
    const modules = await Promise.all(['api','negotiation','request','award'].map(name => import(pathToFileURL(join(directory, `${name}.mjs`)).href)));
    const [api, negotiation, request, award] = modules;
    const comparison = require(join(directory, 'comparison.cjs'));
    const names = ['Trena 5 metros', 'Chave 12 mm', 'alicate universal', 'Chave 2 mm', 'Álcool de limpeza'];
    const items = Object.freeze(names.map((name, index) => Object.freeze({...item(`item-${index}`, `material-${index}`, name), quantity: '1'})));
    const offers = Object.fromEntries(items.map((entry, index) => [entry.id, {
      unitPrice: `${index + 1}.00`, availableQuantity: '1', discountType: 'none', discountValue: '0',
      lineSubtotal: `${index + 1}.00`, discountAmount: '0', lineTotal: `${index + 1}.00`, netUnitPrice: `${index + 1}.00`,
    }]));
    const supplier = {
      id: 'supplier-a', providerId: 'provider-a', providerName: 'Fornecedor teste', values: Object.fromEntries(items.map(i => [i.id, offers[i.id].unitPrice])),
      offers, notes: '', sentAt: null, quotedItemCount: 5, awardedItemCount: 5, grossTotal: '15', total: '15', awardedGrossTotal: '15', awardedTotal: '15',
    };
    globalThis.__alphabeticalQuote = {
      id: 'quote', title: 'Cotação ordenada', number: 'COT-ALFA', requestDate: '2026-11-18', requester: 'Edmilson', notes: '', attachmentKey: null,
      items, providers: [supplier], negotiations: [], status: 'open',
      itemAwards: items.map(i => ({itemId: i.id, providerId: supplier.id, ...offers[i.id], awardedAt: '', updatedAt: ''})),
      awardedItemCount: 5, awardedGrossTotal: '15', awardedTotal: '15', pendingAwardCount: 0, awardComplete: true, purchaseOrders: [],
    };
    const before = JSON.stringify(globalThis.__alphabeticalQuote);
    const displayed = await api.fetchQuote('quote', new AbortController().signal);
    const expected = ['Álcool de limpeza', 'alicate universal', 'Chave 2 mm', 'Chave 12 mm', 'Trena 5 metros'];
    assert.deepEqual(displayed.items.map(i => i.materialName), expected, 'every detail tab receives the same sorted items');
    assert.equal(JSON.stringify(globalThis.__alphabeticalQuote), before, 'sorting must not change the cached RPC payload');
    assert.deepEqual(displayed.itemAwards, globalThis.__alphabeticalQuote.itemAwards);
    for (const entry of displayed.items) assert.equal(supplier.offers[entry.id].unitPrice, offers[entry.id].unitPrice);
    const {renderToStaticMarkup} = await import('react-dom/server');
    const {createElement} = await import('react');
    const html = renderToStaticMarkup(createElement(comparison.QuoteComparisonTab, {quote: globalThis.__alphabeticalQuote, busy: false, finalizing: false, finalizeError: '', onFinalize: async()=>{}, onGoToNegotiation: ()=>{}}));
    let position = -1;
    for (const name of expected) {const next = html.indexOf(name); assert.ok(next > position, `comparison order: ${name}`); position = next;}
    const brand = {company: null, header: {variant: 'compact', logoAlignment: 'left', showCnpj: true, showContact: true}, watermark: {imageUrl: null, opacity: 15, size: 60}, issuer: {id: '', name: 'Teste', email: ''}, issuedAt: new Date('2026-11-18T12:00:00-03:00')};
    const source = globalThis.__alphabeticalQuote;
    const results = [
      await negotiation.createQuotationNegotiationPdf(negotiation.createQuotationNegotiationSnapshot(source, new Map()), brand),
      await request.createQuotationRequestPdf({...source, provider: supplier}, brand),
      await award.createQuotationAwardPdf(award.createQuotationAwardSnapshot(source, supplier, new Map()), brand),
    ];
    const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    for (const result of results) {
      const loading = getDocument({data: new Uint8Array(result.doc.output('arraybuffer')), useSystemFonts: true});
      try {
        const pdf = await loading.promise;
        let text = '';
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {const page = await pdf.getPage(pageNumber);text += (await page.getTextContent()).items.map(i => i.str).join(' ') + ' ';}
        text = text.replace(/\s+/g, ' ');position = -1;
        for (const name of expected) {const next = text.indexOf(name);assert.ok(next > position, `PDF order in ${result.fileName}: ${name}`);position = next;}
      } finally {await loading.destroy();}
    }
    assert.equal(JSON.stringify(source), before, 'all exports preserve original quantities, offers and awards');
  } finally {delete globalThis.__alphabeticalQuote;await rm(directory, {recursive: true, force: true});}
});

test('negotiation tab exposes the complete landscape report with preview and download', async () => {
  const [report, tab, exportDialog] = await Promise.all([
    readFile(reportUrl, 'utf8'), readFile(tabUrl, 'utf8'),
    readFile(new URL('../modules/cotacao/components/QuoteNegotiationExportDialog.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(report, /orientation:\s*'landscape'/);
  assert.match(report, /snapshot\.providers\.length/);
  assert.match(report, /snapshot\.items\.forEach/);
  assert.match(report, /approvedProviderByItem/);
  assert.match(report, /APROVADO/);
  assert.match(report, /Valor total/);
  assert.match(report, /Total com desconto/);
  assert.match(report, /Valor aprovado/);
  assert.match(report, /provider\.awardedItemCount/);
  assert.match(report, /itens aprovados/);
  assert.match(report, /Total aprovado com desconto/);
  assert.match(report, /roundedRect\(x \+ 1\.5/);
  assert.doesNotMatch(report, /Number\([^)]*unitPrice/);
  assert.match(tab, />Exportar PDF</);
  assert.match(tab, /createQuotationNegotiationSnapshot/);
  assert.match(tab, /QuoteNegotiationExportDialog/);
  assert.match(exportDialog, /createPdf=\{createQuotationNegotiationPdf\}/);
  assert.match(exportDialog, /orientation="landscape"/);
  assert.match(exportDialog, /showPreviewToolbar/);
});
