import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const pickerPath = new URL(
  '../modules/cotacao/components/QuoteMaterialPicker.tsx',
  import.meta.url,
);
const createPath = new URL(
  '../modules/cotacao/components/QuoteCreatePage.tsx',
  import.meta.url,
);
const stylesPath = new URL('../modules/cotacao/styles.css', import.meta.url);
const optionsPath = new URL(
  '../modules/cotacao/components/quoteMaterialOptions.ts',
  import.meta.url,
);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.notEqual(end, -1, `${endMarker} must delimit ${startMarker}`);
  return source.slice(start, end);
}

function classRule(source, className) {
  const match = source.match(
    new RegExp(`\\.${className}(?:[^,{]*)\\{([^}]*)\\}`),
  );
  assert.ok(match, `.${className} must have a CSS rule`);
  return match[1];
}

test('quotation material picker exposes an accessible visual product list', async () => {
  const source = await readFile(pickerPath, 'utf8');
  const visual = section(
    source,
    'function MaterialVisual(',
    'export function QuoteMaterialPicker(',
  );

  assert.match(source, /from ['"]@\/components\/ui\/combobox['"]/);
  for (const wrapper of [
    'ComboboxTrigger',
    'ComboboxValue',
    'ComboboxInput',
    'ComboboxItem',
  ]) {
    assert.match(source, new RegExp(`<${wrapper}\\b`), `${wrapper} must be used`);
  }

  assert.match(
    source,
    /<ComboboxTrigger\b[^>]*(?:aria-label|aria-labelledby)=/,
    'the picker trigger needs an accessible name',
  );
  assert.match(
    source,
    /<ComboboxInput\b[^>]*(?:aria-label|aria-labelledby)=/,
    'the searchable input needs an accessible name',
  );
  assert.match(
    source,
    /<ComboboxInput\b[\s\S]*?showTrigger=\{false\}[\s\S]*?\/>/,
    'the popup search must not mount a second trigger and immediately cancel opening',
  );
  assert.equal(
    source.match(/<ComboboxTrigger\b/g)?.length,
    1,
    'the picker root must have exactly one trigger',
  );
  assert.match(source, /itemToStringLabel=\{material\s*=>\s*material\.name\}/);
  assert.match(source, /itemToStringValue=\{material\s*=>\s*material\.id\}/);
  assert.match(source, /<ComboboxItem\b[^>]*value=\{material\}/);

  assert.match(source, /material\.imageUrl/);
  assert.match(
    source,
    /<img\b[^>]*src=\{material\.imageUrl!?\}[^>]*alt=""/,
    'the thumbnail is decorative because the adjacent text identifies the product',
  );
  assert.match(
    source,
    /aria-hidden="true"/,
    'the missing-image fallback must not duplicate the accessible product name',
  );

  const descriptionAt = visual.indexOf('quote-material-description');
  const referencesAt = visual.indexOf('quote-material-references');
  const internalCodeAt = visual.indexOf('quote-material-internal-code');
  assert.ok(descriptionAt >= 0, 'the first text line must contain the product description');
  assert.ok(referencesAt > descriptionAt, 'reference codes must follow the description');
  assert.ok(internalCodeAt > referencesAt, 'the internal code must follow the references');
  assert.match(visual, /material\.name/);
  assert.match(source, /material\.references/);
  assert.match(source, /reference\.code/);
  assert.match(visual, /material\.internalCode/);
  assert.match(
    source,
    /(?:Nenhuma|Sem) refer.ncia(?:s)? cadastrada(?:s)?/,
    'products without references need an explicit fallback',
  );
  assert.match(
    visual,
    /N.o informado/,
    'products without an internal code need an explicit fallback',
  );
});

test('quotation material step preserves materialId selection and separates secondary fields', async () => {
  const source = await readFile(createPath, 'utf8');
  const materialsStep = section(source, 'function MaterialsStep(', 'function ProvidersStep(');

  assert.match(
    source,
    /import\s*\{[^}]*\bQuoteMaterialPicker\b[^}]*\}\s*from\s*['"]\.\/QuoteMaterialPicker['"]/,
  );
  assert.match(materialsStep, /<QuoteMaterialPicker\b/);
  assert.match(materialsStep, /materials=\{options\}/);
  assert.match(materialsStep, /const options = quoteMaterialOptions\(materials\)/);
  assert.match(materialsStep, /value=\{item\.materialId\}/);
  assert.match(
    materialsStep,
    /onChange=\{materialId\s*=>\s*onChange\(item\.id,\s*\{materialId\}\)\}/,
    'the visual picker must keep the existing materialId update contract',
  );
  assert.match(materialsStep, /className="quote-item-secondary"/);
  assert.doesNotMatch(
    materialsStep,
    /<select\b[^>]*value=\{item\.materialId\}/,
    'the native one-line product select must not return',
  );
  assert.doesNotMatch(
    materialsStep,
    /className="quote-item-references"/,
    'references are already shown by the visual picker and must not be duplicated',
  );
});

test('quotation material options include every registered material when one is already selected', async () => {
  const {quoteMaterialOptions} = await import(optionsPath.href);
  const createSource = await readFile(createPath, 'utf8');
  const validation = section(createSource, 'const validateStep =', 'const goToStep =');
  const materials = [
    {id: 'direction-filter', name: 'Filtro de óleo da direção', references: []},
    {
      id: 'lubricant-filter',
      name: 'Filtro de óleo lubrificante - PL519',
      references: [{id: 'mann-h12111', brand: 'MANN', code: 'H12111'}],
    },
    {id: 'hex-nut', name: 'Porca sextavada 8mm - JB1208', references: []},
  ];
  const selectedMaterialId = 'lubricant-filter';

  const options = quoteMaterialOptions(materials);

  assert.equal(options.find(material => material.id === selectedMaterialId)?.id, selectedMaterialId);
  assert.deepEqual(
    options.map(material => material.id),
    ['direction-filter', 'lubricant-filter', 'hex-nut'],
    'materials without references and the currently selected material must remain available',
  );
  assert.doesNotMatch(
    validation,
    /materialReferences\.length/,
    'a registered material without equivalent references must still be accepted by the material step',
  );
});

test('quotation material picker CSS keeps the thumbnail left and form fields responsive', async () => {
  const css = await readFile(stylesPath, 'utf8');
  const visual = classRule(css, 'quote-material-visual');
  const thumbnail = classRule(css, 'quote-material-thumbnail');
  const thumbnailImage = classRule(css, 'quote-material-thumbnail img');
  const description = classRule(css, 'quote-material-description');
  const references = classRule(css, 'quote-material-references');
  const internalCode = classRule(css, 'quote-material-internal-code');
  const secondary = classRule(css, 'quote-item-secondary');

  assert.match(visual, /display:(?:grid|flex)/);
  assert.match(visual, /align-items:center/);
  assert.match(thumbnail, /(?:width|min-width|flex-basis):/);
  assert.match(thumbnail, /(?:height|min-height|aspect-ratio):/);
  assert.match(thumbnailImage, /object-fit:contain/);
  assert.match(description, /font-weight:/);
  assert.match(references, /(?:font-size:|white-space:nowrap)/);
  assert.match(internalCode, /font-size:/);
  assert.match(
    css,
    /\.quote-material-references,\.quote-material-internal-code\{[^}]*font-size:/,
    'the secondary lines must share compact typography',
  );
  assert.match(secondary, /display:grid/);
  assert.match(secondary, /grid-template-columns:/);
  assert.match(
    css,
    /@media\(max-width:700px\)\{[\s\S]*?\.quote-item-secondary\{[^}]*grid-template-columns:1fr/,
    'quantity and notes must stack on narrow screens',
  );
});
