import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const createPath = new URL(
  '../modules/cotacao/components/QuoteCreatePage.tsx',
  import.meta.url,
);
const stylesPath = new URL('../modules/cotacao/styles.css', import.meta.url);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.notEqual(end, -1, `${endMarker} must delimit ${startMarker}`);
  return source.slice(start, end);
}

function component(source, name) {
  const startMarker = `function ${name}(`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nfunction ', start + startMarker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function compact(source) {
  return source.replace(/\s+/g, '');
}

test('new quotation follows the four-step workflow in the required order', async () => {
  const source = await readFile(createPath, 'utf8');
  const declarationMatch = source.match(/const\s+steps\s*=\s*\[([\s\S]*?)\]\s*as const;/);
  assert.ok(declarationMatch, 'the immutable step declaration must exist');
  const stepDeclaration = declarationMatch[1];
  const labels = ['Dados', 'Materiais', 'Prestadores', 'Resumo'];
  let previous = -1;

  for (const label of labels) {
    const occurrences = stepDeclaration.match(new RegExp(`['"]${label}['"]`, 'g')) ?? [];
    assert.equal(occurrences.length, 1, `${label} must occur once in the step declaration`);
    const position = stepDeclaration.indexOf(`'${label}'`);
    assert.ok(position > previous, `${label} must be in the expected step order`);
    previous = position;
  }

  const page = compact(section(source, 'export function QuoteCreatePage()', 'function DataStep('));
  assert.match(page, /step===0&&\(?<DataStep/);
  assert.match(page, /step===1&&\(?<MaterialsStep/);
  assert.match(page, /step===2&&\(?<ProvidersStep/);
  assert.match(page, /step===3&&\(?<ReviewStep/);
  assert.match(
    page,
    /Math\.min\((?:3|steps\.length-1),(?:step|value)\+1\)/,
    'the wizard must be able to advance from providers to review',
  );
});

test('review is the only summary surface and owns the final create action', async () => {
  const source = await readFile(createPath, 'utf8');
  const page = section(source, 'export function QuoteCreatePage()', 'function DataStep(');
  const actions = compact(section(page, '<footer className="quote-step-actions">', '</footer>'));

  assert.doesNotMatch(
    page,
    /<aside\b[^>]*className="quote-draft-summary"/,
    'steps 1-3 must not keep the old lateral summary',
  );
  assert.match(actions, /step<3/);
  assert.match(actions, /onClick=\{advance\}>Avançar/);
  assert.equal(
    actions.match(/onClick=\{\(\)=>voidsave\(\)\}/g)?.length,
    1,
    'there must be one final save CTA',
  );
  assert.match(actions, /Criarcotação/);
  assert.ok(
    actions.indexOf('step<3') < actions.indexOf('onClick={()=>voidsave()}'),
    'save must be the branch reached only after the first three steps',
  );
});

test('review summarizes quotation data, materials, references and providers', async () => {
  const source = await readFile(createPath, 'utf8');
  const review = component(source, 'ReviewStep');

  for (const label of [
    'Número',
    'Automático',
    'Data',
    'Solicitante',
    'Materiais',
    'Prestadores',
  ]) {
    assert.match(review, new RegExp(label), `review must present ${label}`);
  }

  assert.match(review, /dateLabel\(draft\.requestDate\)/);
  assert.match(review, /draft\.requester/);
  assert.match(review, /draft\.notes/);
  assert.match(review, /draft\.items\.map\(/);
  assert.match(review, /item\.materialName/);
  assert.match(review, /item\.materialReferences/);
  assert.match(review, /item\.quantity/);
  assert.match(review, /item\.unit/);
  assert.match(review, /item\.notes/);
  assert.match(review, /draft\.providers\.map\(/);
  assert.match(review, /provider\.providerName/);
});

test('final creation validates required data and materials while providers remain optional', async () => {
  const source = compact(await readFile(createPath, 'utf8'));
  const validator = section(source, 'constvalidateStep=', 'constgoToStep=');
  const advance = section(source, 'constadvance=', 'constsave=');
  const save = section(source, 'constsave=', 'return(');

  assert.match(validator, /(?:target|index)===0/);
  assert.match(validator, /!draft\.requestDate\|\|!draft\.requesterId/);
  assert.match(validator, /(?:target|index)===1/);
  assert.match(validator, /!draft\.items\.length/);
  assert.match(validator, /draft\.items\.some\(/);
  assert.doesNotMatch(validator, /!draft\.providers\.length/);
  assert.match(advance, /validateStep\(step\)/);
  assert.match(
    save,
    /\(\[0,1,2\](?:asconst)?\)\.map\(index=>\(\{index,message:validateStep\(index\)\}\)\)\.find\((entry|result)=>\1\.message\)/,
    'save must revalidate required data and materials independently of the current step',
  );
  assert.match(
    save,
    /(?:setStep|goToStep)\([^)]*\.index/,
    'an invalid final review must return the user to the failing step',
  );
});

test('provider step and review explain that suppliers can be added later', async () => {
  const source = await readFile(createPath, 'utf8');
  const providers = component(source, 'ProvidersStep');
  const review = component(source, 'ReviewStep');

  assert.match(providers, /etapa é opcional/);
  assert.match(providers, /adicionar os fornecedores depois/);
  assert.match(review, /Nenhum fornecedor adicionado/);
  assert.match(review, /adicioná-los depois/);
});

test('quotation modal uses four desktop columns and no lateral summary column', async () => {
  const css = await readFile(stylesPath, 'utf8');
  const stepRules = [...css.matchAll(/\.quote-steps\{([^}]*)\}/g)].map(match => match[1]);
  const layoutRules = [...css.matchAll(/\.quote-create-layout\{([^}]*)\}/g)].map(
    match => match[1],
  );

  assert.ok(
    stepRules.some(rule => /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/.test(rule)),
    'the desktop stepper must expose all four stages',
  );
  assert.ok(
    stepRules.every(rule => !/repeat\(3,/.test(rule)),
    'a later three-column rule must not override the four-step layout',
  );
  assert.ok(layoutRules.length > 0, '.quote-create-layout must have a CSS rule');
  assert.ok(
    layoutRules.every(rule => !/275px/.test(rule)),
    'the form must not reserve width for the removed summary aside',
  );
  assert.ok(
    layoutRules.some(rule => /(?:display:block|grid-template-columns:1fr)/.test(rule)),
    'the active step must occupy the available modal width',
  );
  assert.doesNotMatch(
    css,
    /\.quote-draft-summary\{[^}]*position:sticky/,
    'the removed lateral summary must not remain sticky',
  );
});
