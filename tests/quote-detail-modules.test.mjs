import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const componentUrl = name => new URL(
  `../modules/cotacao/components/${name}.tsx`,
  import.meta.url,
);

async function readComponent(name) {
  try {
    return await readFile(componentUrl(name), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(`${name}.tsx must exist as a separate quotation detail module`);
    }
    throw error;
  }
}

function appearsInOrder(source, labels) {
  let previous = -1;
  for (const label of labels) {
    const current = source.indexOf(label);
    assert.ok(current > previous, `${label} must appear in the expected order`);
    previous = current;
  }
}

test('quotation detail is split into accessible Summary, Negotiation and Suppliers tabs', async () => {
  const [detail, summary, negotiation, providers, priceDialog] = await Promise.all([
    readComponent('QuoteDetailPage'),
    readComponent('QuoteSummaryTab'),
    readComponent('QuoteNegotiationTab'),
    readComponent('QuoteProvidersTab'),
    readComponent('QuotePriceDialog'),
  ]);

  assert.match(
    detail,
    /import\s*\{[^}]*\bTabs\b[^}]*\bTabsList\b[^}]*\bTabsTrigger\b[^}]*\bTabsContent\b[^}]*\}\s*from\s*['"]@\/components\/ui\/tabs['"]/s,
  );
  for (const name of [
    'QuoteSummaryTab',
    'QuoteNegotiationTab',
    'QuoteProvidersTab',
  ]) {
    assert.match(
      detail,
      new RegExp(`import\\s*\\{${name}\\}\\s*from\\s*['"]\\./${name}['"]`),
      `${name} must be composed by QuoteDetailPage`,
    );
    assert.match(detail, new RegExp(`<${name}\\b`));
  }

  const list = detail.match(/<TabsList\b[\s\S]*?<\/TabsList>/)?.[0] ?? '';
  assert.match(list, /aria-label=/, 'the tab list needs an accessible name');
  assert.equal(
    list.match(/<TabsTrigger\b/g)?.length,
    3,
    'quotation detail must expose exactly three primary tabs',
  );
  appearsInOrder(list, ['Resumo', 'Negociação', 'Fornecedores']);
  assert.equal(
    detail.match(/<TabsContent\b/g)?.length,
    3,
    'each trigger needs a corresponding tab panel',
  );

  assert.match(summary, /export function QuoteSummaryTab\b/);
  assert.match(negotiation, /export function QuoteNegotiationTab\b/);
  assert.match(providers, /export function QuoteProvidersTab\b/);
  assert.match(priceDialog, /export function QuotePriceDialog\b/);
});

test('summary tab presents quotation data, materials, suppliers and winner results', async () => {
  const source = await readComponent('QuoteSummaryTab');

  for (const label of ['Dados da cotação', 'Materiais', 'Fornecedores']) {
    assert.match(source, new RegExp(label), `summary must identify ${label}`);
  }
  assert.match(source, /quote\.number/);
  assert.match(source, /dateLabel\(quote\.requestDate\)/);
  assert.match(source, /quote\.requester/);
  assert.match(source, /quote\.status/);
  assert.match(source, /quote\.notes/);

  assert.match(source, /quote\.items\.map\(/);
  assert.match(source, /item\.materialName/);
  assert.match(source, /item\.materialReferences/);
  assert.match(source, /item\.quantity/);
  assert.match(source, /item\.unit/);

  assert.match(source, /quote\.providers\.map\(/);
  assert.match(source, /provider\.providerName/);
  assert.match(source, /provider\.total/);
  assert.match(source, /quote\.winningProviderIds/);
  assert.match(
    source,
    /(?:Vencedor|Menor (?:preço|total)|Empate|Aguardando)/,
    'the summary must make the price result or winner visible',
  );
});

test('negotiation tab crosses materials with suppliers and opens the new-price dialog', async () => {
  const [source, dialog] = await Promise.all([
    readComponent('QuoteNegotiationTab'),
    readComponent('QuotePriceDialog'),
  ]);

  assert.match(
    source,
    /import\s*\{QuotePriceDialog\}\s*from\s*['"]\.\/QuotePriceDialog['"]/,
  );
  assert.match(source, /quote\.items\.map\(/);
  assert.match(source, /quote\.providers\.map\(/);
  assert.match(source, /item\.materialName/);
  assert.match(source, /provider\.providerName/);
  assert.match(source, /provider\.values\[item\.id\]/);
  assert.match(source, />Novo preço</);
  assert.match(
    source,
    /onClick=\{[^}]*set[A-Z][A-Za-z]*(?:Price|Entry|Selection|Dialog|Editor)[^}]*\}/,
    'the new-price action must open controlled dialog state',
  );
  assert.match(source, /<QuotePriceDialog\b/);

  assert.match(dialog, /from ['"]@\/components\/ui\/dialog['"]/);
  assert.match(dialog, /<Dialog\b/);
  assert.match(dialog, /<DialogContent\b/);
  assert.match(dialog, /<DialogTitle>Novo preço<\/DialogTitle>/);
  assert.match(dialog, /(?:Valor unitário|Preço)/);
  assert.match(dialog, /(?:onSave|onSubmit)/);
});

test('negotiation exposes a chronological, versioned price history', async () => {
  const source = [
    await readComponent('QuoteNegotiationTab'),
    await readComponent('QuotePriceDialog'),
  ].join('\n');

  assert.match(source, /Histórico(?: de preços)?/);
  assert.match(
    source,
    /(?:priceHistory|history|revisions|versions)/i,
    'history must come from an explicit collection',
  );
  assert.match(
    source,
    /(?:priceHistory|history|revisions|versions)[\s\S]{0,180}\.map\(/i,
    'the version collection must be rendered, not only mentioned',
  );
  assert.match(source, /\.version\b/);
  assert.match(source, /(?:Versão|Versao|v\{)/);
  assert.match(source, /(?:createdAt|dateLabel|dateTime)/);
  assert.match(source, /moneyLabel\(/);
});

test('negotiation retries are idempotent and reject synchronous double submit', async () => {
  const [dialog, types] = await Promise.all([
    readComponent('QuotePriceDialog'),
    readFile(new URL('../modules/cotacao/types.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(types, /export type QuoteNegotiationInput\s*=\s*\{[\s\S]*?requestId:\s*string;/);
  assert.match(dialog, /requestRef\s*=\s*useRef<\{fingerprint:\s*string;\s*requestId:\s*string\}/);
  assert.match(dialog, /requestRef\.current\?\.fingerprint\s*!==\s*fingerprint/);
  assert.match(dialog, /requestRef\.current\s*=\s*\{fingerprint,\s*requestId:\s*crypto\.randomUUID\(\)\}/);
  assert.match(dialog, /requestId:\s*requestRef\.current\.requestId/);
  assert.match(dialog, /if\s*\(saving\s*\|\|\s*submittingRef\.current\)\s*return/);
  assert.ok(
    dialog.indexOf('submittingRef.current = true') < dialog.indexOf('await onSave'),
    'the in-flight guard must be raised synchronously before calling the mutation',
  );
});

test('negotiation is a supplier matrix with per-item approval and accessible abbreviated headings', async () => {
  const [source, detail, css] = await Promise.all([
    readComponent('QuoteNegotiationTab'),
    readComponent('QuoteDetailPage'),
    readFile(new URL('../modules/cotacao/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /<table[\s\S]{0,160}className="quote-negotiation-matrix"/);
  assert.match(source, /quote\.items\.map\(item =>[\s\S]*?quote\.providers\.map\(provider =>/);
  assert.match(source, /className="quote-matrix-material-column" scope="row"/);
  assert.match(source, /import\s*\{MaterialThumbnail\}\s*from\s*['"]\.\/QuoteMaterialPicker['"]/);
  assert.match(source, /materialById\.get\(item\.materialId\)/);
  assert.match(source, /<MaterialThumbnail material=\{material\}\/>/);
  assert.match(source, /className="quote-matrix-material"[\s\S]*?<MaterialThumbnail[\s\S]*?item\.materialName/);
  assert.match(detail, /<QuoteNegotiationTab[\s\S]*?materials=\{materialsQuery\.materials\}/);
  assert.match(source, /providerAbbreviation\(provider\.providerName\)/);
  assert.match(source, /title=\{provider\.providerName\}/);
  assert.match(source, /<TooltipContent[\s\S]*?provider\.providerName/);
  assert.match(source, /quote\.itemAwards[^;\n]*\.map\(/);
  assert.match(source, /type="radio"/);
  assert.match(source, /name=\{`approved-provider-\$\{item\.id\}`\}/);
  assert.match(source, /onApproveItem\(\{quotationItemId: item\.id, quotationProviderId: provider\.id\}\)/);
  assert.match(source, />Adicionar materiais</);
  assert.match(source, /onClick=\{onAddMaterials\}/);

  assert.match(css, /\.quote-negotiation-matrix-wrap\{[^}]*overflow:auto/);
  assert.match(css, /\.quote-negotiation-matrix \.quote-matrix-material-column\{[^}]*position:sticky;left:0/);
  assert.match(css, /\.quote-matrix-material\{[^}]*grid-template-columns:64px minmax\(0,1fr\)/);
  assert.match(css, /\.quote-negotiation-matrix tbody td\.is-approved/);
});

test('suppliers tab uses a semantic table and Export opens PdfExportDialog', async () => {
  const source = await readComponent('QuoteProvidersTab');

  assert.match(source, /import\s*\{PdfExportDialog\}\s*from\s*['"]@\/shared\/reporting\/PdfExportDialog['"]/);
  assert.match(source, /import\s*\{[^}]*createQuotationRequestPdf[^}]*\}\s*from\s*['"]\.\.\/reporting\/quotationRequestPdf['"]/s);
  assert.match(source, /<table\b/);
  assert.match(source, /<thead>[\s\S]*?<tbody>/);
  assert.match(source, /<th\b[^>]*scope="col"/);
  assert.match(source, /quote\.providers\.map\(/);
  assert.match(source, /provider\.providerName/);
  assert.match(source, /provider\.providerEmail/);
  assert.match(source, /provider\.providerPhone/);
  assert.match(source, /<button\b[^>]*onClick=\{[^}]*setPdf[^}]*\}[^>]*>[\s\S]*?Exportar[\s\S]*?<\/button>/);
  assert.match(source, /\{pdf&&[\s\S]*?<PdfExportDialog\b/);
  assert.match(source, /snapshot=\{pdf\}/);
  assert.match(source, /createPdf=\{createQuotationRequestPdf\}/);
  assert.match(source, /onClose=\{\(\)=>setPdf\(null\)\}/);
});

test('open quotation scope can grow and shrink without replacing existing negotiation history', async () => {
  const [detail, dialogs, api, hooks] = await Promise.all([
    readComponent('QuoteDetailPage'),
    readComponent('QuoteScopeDialogs'),
    readFile(new URL('../modules/cotacao/services/quoteApi.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/cotacao/hooks/useQuotes.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(detail, /<QuoteAddMaterialDialog\b/);
  assert.match(detail, /<QuoteAddProviderDialog\b/);
  assert.match(detail, /mutations\.addItems\(\{id:\s*quote\.id,\s*items:\s*\[item\]\}\)/);
  assert.match(detail, /mutations\.addProviders\(\{id:\s*quote\.id,\s*providers\}\)/);
  assert.match(detail, /mutations\.removeItem\(\{id:\s*quote\.id,\s*quotationItemId:\s*item\.id\}\)/);
  assert.match(detail, /mutations\.removeProvider\(\{id:\s*quote\.id,\s*quotationProviderId:\s*provider\.id\}\)/);
  assert.match(detail, /title:\s*'Remover material da cotação\?'/);
  assert.match(detail, /title:\s*'Remover fornecedor da cotação\?'/);
  assert.match(detail, /onAddMaterials=\{\(\)\s*=>\s*setAddingMaterial\(true\)\}/);
  assert.match(detail, /onAddProviders=\{\(\)\s*=>\s*setAddingProviders\(true\)\}/);

  assert.match(dialogs, /export function QuoteAddMaterialDialog\b/);
  assert.match(dialogs, /export function QuoteAddProviderDialog\b/);
  assert.match(dialogs, /crypto\.randomUUID\(\)/);
  assert.match(dialogs, /retryItemId\s*=\s*useRef/);
  assert.match(dialogs, /retryItemId\.current\s*\?\?=\s*crypto\.randomUUID\(\)/);
  assert.match(dialogs, /id:\s*retryItemId\.current/);
  assert.match(dialogs, /retryProviderIds\s*=\s*useRef\(new Map/);
  assert.match(dialogs, /retryProviderIds\.current\.get\(providerId\)/);
  assert.match(dialogs, /retryProviderIds\.current\.set\(providerId, id\)/);
  assert.match(dialogs, /existingMaterialIds\.has\(material\.id\)/);
  assert.match(dialogs, /existingProviderIds\.has\(provider\.id\)/);
  assert.match(dialogs, /catalogLoading:\s*boolean/);
  assert.match(dialogs, /catalogError:\s*string/);
  assert.match(dialogs, /onReloadCatalog:\s*\(\)\s*=>\s*Promise<void>/);
  assert.match(dialogs, /Carregando materiais/);
  assert.match(dialogs, /Não foi possível carregar os materiais/);
  assert.match(dialogs, /Carregando fornecedores/);
  assert.match(dialogs, /Não foi possível carregar os fornecedores/);
  assert.match(detail, /catalogLoading=\{materialsQuery\.loading\}/);
  assert.match(detail, /catalogError=\{materialsQuery\.error\}/);
  assert.match(detail, /onReloadCatalog=\{materialsQuery\.reload\}/);
  assert.match(detail, /catalogLoading=\{providersQuery\.loading\}/);
  assert.match(detail, /catalogError=\{providersQuery\.error\}/);
  assert.match(detail, /onReloadCatalog=\{providersQuery\.reload\}/);

  for (const action of ['award-item', 'add-items', 'add-providers', 'remove-item', 'remove-provider']) {
    assert.match(api, new RegExp(`['"]quotations['"],['"]${action}['"]`));
  }
  for (const mutation of ['approveItem', 'addItems', 'addProviders', 'removeItem', 'removeProvider']) {
    assert.match(hooks, new RegExp(`${mutation}:\\(input:`));
  }
});

test('material and supplier removal controls are guarded by recorded prices and history', async () => {
  const [summary, providers] = await Promise.all([
    readComponent('QuoteSummaryTab'),
    readComponent('QuoteProvidersTab'),
  ]);

  assert.match(summary, /onRemoveMaterial/);
  assert.match(summary, /quote\.negotiations\.some\(entry => entry\.itemId === item\.id\)/);
  assert.match(summary, /quote\.items\.length <= 1/);
  assert.match(summary, /aria-label=\{`Remover \$\{item\.materialName\} da cotação`\}/);
  assert.match(providers, /onRemoveProvider/);
  assert.match(providers, /quote\.negotiations\.some\(entry => entry\.providerId === provider\.id\)/);
  assert.match(providers, /aria-label=\{`Remover \$\{provider\.providerName\} da cotação`\}/);
});

test('quotation list is an operational workspace with KPIs, aligned filters and a four-column card grid', async () => {
  const source = await readComponent('QuoteList');

  assert.match(source, /useQuotes\(['"]open['"]\)/);
  assert.match(source, /useQuotes\(['"]finished['"]\)/);
  assert.match(source, /className="quote-list-kpis"/);
  for (const label of [
    'Em aberto',
    'Finalizadas',
    'Materiais na seleção',
    'Prestadores na seleção',
  ]) {
    assert.match(source, new RegExp(label), `quotation workspace must expose ${label}`);
  }

  assert.match(source, /className="quote-list-toolbar"/);
  assert.match(source, /Buscar por número, material ou solicitante/);
  assert.match(source, /Todos os materiais/);
  assert.match(source, /Todos os prestadores/);
  assert.match(source, /clearFilters/);

  assert.match(source, /className="quote-list-card-grid" role="list"/);
  assert.match(source, /className=\{`quote-list-card \$\{quote\.status\}`\} role="listitem"/);
  assert.match(source, /className="quote-list-card-header"/);
  assert.match(source, /className="quote-list-card-meta"/);
  assert.match(source, /className="quote-list-card-scope"/);
  assert.match(source, /className="btn quote-list-card-open"/);
  assert.match(source, /completeProviderCount\(quote\)/);
  assert.match(source, /quote\.items\.slice\(0,2\)/);
  assert.match(source, /quoteHref\(quote\.id\)/);
  assert.match(source, /aria-label=\{`Abrir \$\{quote\.number\|\|quote\.title\}`\}/);
});

test('quotation workspace remains usable on tablet and mobile breakpoints', async () => {
  const css = await readFile(new URL('../modules/cotacao/styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.quote-list-workspace\{/);
  assert.match(css, /\.quote-list-card-grid\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:1500px\)\{\.quote-list-card-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\}/);
  assert.match(css, /@media\(max-width:1180px\)\{[\s\S]*?\.quote-list-card-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /@media\(max-width:560px\)\{[\s\S]*?\.quote-list-kpis\{grid-template-columns:1fr/);
  assert.match(css, /@media\(max-width:560px\)\{[\s\S]*?\.quote-list-card-grid\{grid-template-columns:1fr/);
});
