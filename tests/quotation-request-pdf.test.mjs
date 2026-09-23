import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('vite')]}));
const jsPdfModulePath = require.resolve('jspdf');
const pdfSourceUrl = new URL('../modules/cotacao/reporting/quotationRequestPdf.ts', import.meta.url);
const providersSourceUrl = new URL('../modules/cotacao/components/QuoteProvidersTab.tsx', import.meta.url);

const onePixelPng = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 1, 115, 82, 71, 66, 0, 174, 206, 28, 233, 0, 0, 0,
  13, 73, 68, 65, 84, 24, 87, 99, 96, 96, 96, 248, 15, 0, 1, 4,
  1, 0, 112, 32, 101, 11, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
  96, 130,
];

function virtualPdfDependencies() {
  return {
    name: 'quotation-pdf-test-instrumentation',
    setup(builder) {
      builder.onResolve(
        {filter: /^@\/shared\/reporting\/loadReportImage$/},
        () => ({path: 'quotation-image-loader', namespace: 'quotation-test'}),
      );
      builder.onResolve(
        {filter: /^@\/shared\/reporting\/jsPdfRuntime$/},
        () => ({path: 'quotation-jspdf-runtime', namespace: 'quotation-test'}),
      );
      builder.onResolve(
        {filter: /^jspdf$/, namespace: 'quotation-test'},
        () => ({path: jsPdfModulePath}),
      );
      builder.onLoad(
        {filter: /^quotation-image-loader$/, namespace: 'quotation-test'},
        () => ({
          loader: 'js',
          contents: `
            export async function loadReportImage(url) {
              if (!url) return null;
              globalThis.__quotationImageRequests.push(url);
              return {
                bytes: Uint8Array.from(${JSON.stringify(onePixelPng)}),
                ratio: 1,
                format: 'PNG',
              };
            }
          `,
        }),
      );
      builder.onLoad(
        {filter: /^quotation-jspdf-runtime$/, namespace: 'quotation-test'},
        () => ({
          loader: 'js',
          contents: `
            import {jsPDF as ActualJsPdf} from 'jspdf';
            export function jsPDF(options) {
              const document = new ActualJsPdf(options);
              const actualText = document.text.bind(document);
              const actualAddImage = document.addImage.bind(document);
              document.text = (value, x, y, ...rest) => {
                globalThis.__quotationTextDraws.push({
                  value: Array.isArray(value) ? value.join('\\n') : String(value),
                  x,
                  y,
                  fontSize: document.getFontSize(),
                  page: document.getCurrentPageInfo().pageNumber,
                });
                return actualText(value, x, y, ...rest);
              };
              document.addImage = (...args) => {
                const options = args[0] && typeof args[0] === 'object'
                  && !ArrayBuffer.isView(args[0]) ? args[0] : null;
                globalThis.__quotationImageDraws.push({
                  x: options?.x ?? args[2],
                  y: options?.y ?? args[3],
                  width: options?.w ?? options?.width ?? args[4],
                  height: options?.h ?? options?.height ?? args[5],
                  page: document.getCurrentPageInfo().pageNumber,
                });
                return actualAddImage(...args);
              };
              return document;
            }
          `,
        }),
      );
    },
  };
}

function textDraw(draws, value) {
  return draws.find(draw => draw.value.includes(value));
}

test('quotation request snapshot receives each signed material image from the catalog', async () => {
  const [pdfSource, providersSource] = await Promise.all([
    readFile(pdfSourceUrl, 'utf8'),
    readFile(providersSourceUrl, 'utf8'),
  ]);

  assert.match(
    pdfSource,
    /type\s+QuotationRequestItem\s*=\s*QuoteItem\s*&\s*\{[^}]*materialImageUrl\??\s*:\s*string\s*\|\s*null/s,
    'the export-only item type must accept the signed catalog image URL',
  );
  assert.match(
    providersSource,
    /\buseMaterials\s*\(/,
    'the supplier export must load the signed material catalog',
  );
  for (const property of ['materialImageUrl', 'materialId', 'imageUrl']) {
    assert.match(
      providersSource,
      new RegExp(`\\b${property}\\b`),
      `the PDF snapshot enrichment must use ${property}`,
    );
  }
  assert.doesNotMatch(
    pdfSource,
    /line\(\s*['"]Solicitante['"]|text\(\s*['"]SOLICITANTE['"]|snapshot\.requester/,
    'the supplier-facing form must not print the requester',
  );
});

test('quotation request PDF is a roomy supplier form with photo, prices, discounts and totals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quotation-request-pdf-'));
  try {
    const outfile = join(directory, 'quotation-request-pdf.mjs');
    await build({
      entryPoints: ['modules/cotacao/reporting/quotationRequestPdf.ts'],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      plugins: [virtualPdfDependencies()],
      logLevel: 'silent',
    });
    const {createQuotationRequestPdf} = await import(pathToFileURL(outfile).href);
    globalThis.__quotationImageRequests = [];
    globalThis.__quotationImageDraws = [];
    globalThis.__quotationTextDraws = [];

    const snapshot = {
      title: 'Cotação de 23/09/2026',
      number: 'COT-001',
      requestDate: '2026-09-23',
      requester: 'REQUESTER_MUST_NOT_APPEAR',
      notes: '',
      provider: {
        id: 'quotation-provider',
        providerId: 'provider',
        providerName: 'ANA CRISTINA ALVES DE OLIVEIRA',
        providerDocumentType: 'CNPJ',
        providerDocument: '04773159000523',
        values: {},
        notes: '',
        sentAt: null,
      },
      items: [
        {
          id: 'item-with-photo',
          materialId: 'material-with-photo',
          materialVariantId: '',
          materialName: 'FILTRO COM FOTO',
          materialCode: 'MAT-001',
          materialApplication: 'Aplicação do primeiro produto',
          materialReferences: [{brand: 'MANN', code: 'H12111'}],
          materialImageUrl: 'mock://signed-material-photo',
          quantity: '5',
          unit: 'PC',
          notes: '',
        },
        {
          id: 'item-without-photo',
          materialId: 'material-without-photo',
          materialVariantId: '',
          materialName: 'FILTRO SEM FOTO',
          materialCode: 'MAT-002',
          materialApplication: '',
          materialReferences: [],
          materialImageUrl: null,
          quantity: '12',
          unit: 'UN',
          notes: '',
        },
      ],
    };
    const before = JSON.stringify(snapshot);
    const brand = {
      company: null,
      header: {variant: 'detailed', logoAlignment: 'right', showCnpj: true, showContact: true},
      watermark: {imageUrl: null, opacity: 15, size: 60},
      issuer: {id: 'user', name: 'Teste PDF', email: ''},
      issuedAt: new Date('2026-09-23T14:00:00-03:00'),
    };

    const {doc, fileName} = await createQuotationRequestPdf(snapshot, brand);
    const draws = globalThis.__quotationTextDraws;
    const allText = draws.map(draw => draw.value).join('\n');
    const searchableText = allText.replace(/\s+/g, ' ');

    assert.equal(JSON.stringify(snapshot), before, 'PDF generation must not mutate its snapshot');
    assert.equal(fileName, 'cotacao-cot-001-ana-cristina-alves-de-oliveira.pdf');
    assert.equal(
      new TextDecoder().decode(new Uint8Array(doc.output('arraybuffer')).slice(0, 4)),
      '%PDF',
    );
    assert.deepEqual(
      globalThis.__quotationImageRequests,
      ['mock://signed-material-photo'],
      'only the item that has a registered photo should request an image',
    );
    assert.equal(globalThis.__quotationImageDraws.length, 1, 'the registered product photo must be drawn once');

    const supplier = textDraw(draws, 'ANA CRISTINA ALVES DE OLIVEIRA');
    const supplierDocument = textDraw(draws, 'CNPJ: 04.773.159/0005-23');
    const quietTitle = textDraw(draws, 'Cotação de 23/09/2026');
    assert.ok(supplier, 'the recipient supplier must be prominent');
    assert.ok(supplierDocument, 'the recipient CNPJ must be formatted');
    assert.ok(quietTitle, 'the quotation identification must remain present');
    assert.ok(supplier.fontSize > quietTitle.fontSize, 'supplier emphasis must exceed the discreet quotation title');
    assert.ok(
      supplierDocument.y > supplier.y && supplierDocument.y - supplier.y <= 8,
      'the formatted CNPJ must sit directly below the supplier name',
    );
    assert.ok(!allText.includes('REQUESTER_MUST_NOT_APPEAR'), 'the requester name must not leak into this PDF');
    assert.ok(!draws.some(draw => draw.value.trim() === 'SOLICITANTE'), 'the requester label must be absent');

    for (const label of [
      'Produto',
      'Qtd. solicitada',
      'Qtd. disponível',
      'Valor unitário',
      'Desc. unitário',
      'Desc. total',
      'Valor total',
      'Subtotal',
    ]) {
      assert.ok(searchableText.includes(label), `the supplier form must include ${label}`);
    }
    assert.ok(
      searchableText.lastIndexOf('Valor total') > searchableText.lastIndexOf('Subtotal'),
      'the grand total must follow the subtotal',
    );

    const firstProduct = textDraw(draws, 'FILTRO COM FOTO');
    const secondProduct = textDraw(draws, 'FILTRO SEM FOTO');
    const image = globalThis.__quotationImageDraws[0];
    assert.ok(firstProduct && secondProduct, 'every requested product must reach the form');
    assert.ok(
      image.x + image.width <= firstProduct.x,
      'the registered photo must stay on the left of the product description',
    );
    assert.ok(image.height >= 17, 'the product photo must remain large enough to identify');
    assert.ok(
      secondProduct.y - firstProduct.y >= 17,
      'each product needs approximately three text lines of vertical space',
    );
  } finally {
    delete globalThis.__quotationImageRequests;
    delete globalThis.__quotationImageDraws;
    delete globalThis.__quotationTextDraws;
    if (!resolve(directory).startsWith(join(resolve(tmpdir()), 'quotation-request-pdf-'))) {
      throw new Error('Unsafe test cleanup path');
    }
    await rm(directory, {recursive: true, force: true});
  }
});
