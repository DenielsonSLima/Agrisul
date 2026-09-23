import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const createPath = new URL(
  '../modules/cotacao/components/QuoteCreatePage.tsx',
  import.meta.url,
);
const scopeDialogsPath = new URL(
  '../modules/cotacao/components/QuoteScopeDialogs.tsx',
  import.meta.url,
);
const stylesPath = new URL('../modules/cotacao/styles.css', import.meta.url);

function component(source, name) {
  const startMarker = `function ${name}(`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nfunction ', start + startMarker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function classRule(source, className) {
  const match = source.match(
    new RegExp(`\\.${className}(?=[\\s.#:[>+~,{])(?:[^,{]*)\\{([^}]*)\\}`),
  );
  assert.ok(match, `.${className} must have a CSS rule`);
  return match[1];
}

test('provider step renders a selectable semantic table', async () => {
  const source = await readFile(createPath, 'utf8');
  const providersStep = component(source, 'ProvidersStep');

  assert.match(providersStep, /<div className="quote-provider-table-wrap"/);
  assert.match(providersStep, /<table className="quote-provider-table"/);
  assert.match(providersStep, /<thead>[\s\S]*?<tbody>/);
  assert.match(providersStep, /<th\b[^>]*scope="col"/);
  assert.match(providersStep, /filtered\.map\(provider\s*=>/);
  assert.match(providersStep, /<tr\b[^>]*key=\{provider\.id\}/);
  assert.match(providersStep, /className=\{active\s*\?\s*['"]selected['"]/);
  assert.match(providersStep, /<td className="quote-provider-select-cell">/);
  assert.match(
    providersStep,
    /<input\b[^>]*type="checkbox"[^>]*checked=\{active\}[^>]*onChange=\{\(\)\s*=>\s*onToggle\(provider\)\}/,
  );
});

test('provider row keeps the legal name above formatted document and trade name', async () => {
  const source = await readFile(createPath, 'utf8');
  const providersStep = component(source, 'ProvidersStep');

  assert.match(
    source,
    /import\s*\{[^}]*\bproviderDocument\b[^}]*\}\s*from\s*['"]@\/modules\/cadastro\/prestadores\/presentation['"]/,
    'provider documents must use the shared CPF/CNPJ formatter',
  );
  assert.match(
    providersStep,
    /<strong className="quote-provider-name">\{provider\.legalName\}<\/strong>/,
  );
  assert.match(
    providersStep,
    /<span className="quote-provider-document">[\s\S]*?providerDocument\(provider\)[\s\S]*?<\/span>/,
  );
  assert.match(
    providersStep,
    /<span className="quote-provider-trade">[\s\S]*?provider\.tradeName[\s\S]*?<\/span>/,
  );

  const nameAt = providersStep.indexOf('quote-provider-name');
  const metaAt = providersStep.indexOf('quote-provider-meta');
  const documentAt = providersStep.indexOf('quote-provider-document');
  const tradeAt = providersStep.indexOf('quote-provider-trade');
  assert.ok(nameAt >= 0 && metaAt > nameAt, 'the metadata must be below the legal name');
  assert.ok(documentAt > metaAt, 'the formatted document must be on the metadata line');
  assert.ok(tradeAt > documentAt, 'the trade name must follow the formatted document');
});

test('add-provider dialog keeps selection in the compact checkbox column', async () => {
  const source = await readFile(scopeDialogsPath, 'utf8');
  const dialog = component(source, 'QuoteAddProviderDialog');

  assert.match(
    dialog,
    /<th className="quote-provider-select-heading" scope="col">Selecionar<\/th>/,
    'the dialog must apply the fixed-width selection heading',
  );
  assert.match(
    dialog,
    /<td className="quote-provider-select-cell">[\s\S]*?<label[\s\S]*?<input[\s\S]*?type="checkbox"[\s\S]*?<span className="quote-provider-check"><Check/,
    'the dialog must render the same visible checkbox control used by the creation flow',
  );
});

test('provider search covers legal name, trade name and raw and formatted documents', async () => {
  const source = await readFile(createPath, 'utf8');
  const providersStep = component(source, 'ProvidersStep');
  const filterStart = providersStep.indexOf('const filtered');
  const filterEnd = providersStep.indexOf('return (', filterStart);
  assert.notEqual(filterStart, -1, 'provider filtering must exist');
  assert.notEqual(filterEnd, -1, 'provider filtering must precede rendering');
  const filter = providersStep.slice(filterStart, filterEnd);

  for (const field of ['legalName', 'tradeName', 'document']) {
    assert.match(filter, new RegExp(`provider\\.${field}\\b`), `search must include ${field}`);
  }
  assert.match(
    filter,
    /providerDocument\(provider\)/,
    'search must match the document as users see it in the table',
  );
});

test('provider table styles expose selection and remain usable on narrow screens', async () => {
  const css = await readFile(stylesPath, 'utf8');
  const wrapper = classRule(css, 'quote-provider-table-wrap');
  const table = classRule(css, 'quote-provider-table');
  const copy = classRule(css, 'quote-provider-copy');
  const metadata = classRule(css, 'quote-provider-meta');

  assert.match(wrapper, /overflow-x:auto/);
  assert.match(table, /width:100%/);
  assert.match(table, /border-collapse:/);
  assert.match(copy, /display:grid/);
  assert.match(metadata, /display:(?:flex|grid)/);
  assert.match(
    css,
    /\.quote-provider-table[^,{]*\.selected(?:[^,{]*)\{[^}]*(?:background|border|box-shadow):/,
    'the selected provider row needs a visible state',
  );
  assert.match(
    css,
    /@media\(max-width:700px\)\{[\s\S]*?\.quote-provider-(?:table|meta|select-cell)[^{]*\{[^}]+\}/,
    'the provider table needs a narrow-screen adjustment',
  );
});
