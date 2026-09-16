import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../shared/utils/currencyInput.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022}});
const {currencyDecimal, currencyClipboardDecimal, formatCurrencyInput, currencyPayload, currencyEditableDecimal, currencyRawPosition, currencyDisplayPosition, editCurrencyInput} = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

test('money uses Brazilian separators without changing the decimal sent to the RPC', () => {
  for (const [raw, shown] of [['', ''], ['0', 'R$ 0,00'], ['200000', 'R$ 200.000,00'], ['1500.5', 'R$ 1.500,50'], ['999999999999999.99', 'R$ 999.999.999.999.999,99'], ['1.311999', 'R$ 1,311999']]) {
    assert.equal(formatCurrencyInput(raw), shown);
    assert.equal(currencyPayload(raw), raw);
  }
  assert.equal(currencyPayload('20.'), '20');
  assert.equal(currencyDecimal('0001500,50'), '1500.50');
});

test('whole reais are grouped while typing and cents are entered after the comma', () => {
  let decimal = '';
  for (const digit of '200000') {
    const edit = editCurrencyInput(decimal, decimal.length, decimal.length, digit, 2);
    decimal = edit.decimal;
    assert.equal(currencyDisplayPosition(decimal, edit.cursor), formatCurrencyInput(decimal).indexOf(','));
  }
  assert.equal(formatCurrencyInput(decimal), 'R$ 200.000,00');
  decimal = editCurrencyInput(decimal, 6, 6, ',', 2).decimal;
  decimal = editCurrencyInput(decimal, 7, 7, '5', 2).decimal;
  assert.equal(formatCurrencyInput(decimal), 'R$ 200.000,50');
  decimal = editCurrencyInput(decimal, 8, 8, '9', 2).decimal;
  assert.equal(currencyPayload(decimal), '200000.59');
  assert.equal(editCurrencyInput(decimal, 9, 9, '1', 2), null);
});

test('editing, clearing and cursor positions preserve digits around grouping and padding', () => {
  const decimal = '1234567.89';
  for (let index = 0; index <= decimal.length; index++) {
    assert.equal(currencyRawPosition(decimal, currencyDisplayPosition(decimal, index)), index);
  }
  assert.equal(currencyRawPosition('1500', 'R$ 1.500,00'.length), 4);
  assert.equal(editCurrencyInput('1234.56', 1, 3, '9', 2).decimal, '194.56');
  assert.equal(editCurrencyInput('1234.56', 0, 7, '', 2).decimal, '');
  assert.deepEqual(editCurrencyInput('0', 1, 1, '5', 2), {decimal: '5', cursor: 1});
  assert.equal(editCurrencyInput('0.5', 0, 1, '', 2).decimal, '0.5');
});

test('pasted currency and existing six-decimal rates keep exact precision', () => {
  for (const [text, decimal] of [['R$\u00a0200.000,50', '200000.50'], ['200.000', '200000'], ['200000.50', '200000.50'], ['1,311999', '1.311999'], ['R$ 75,123456', '75.123456']]) {
    assert.equal(currencyClipboardDecimal(text), decimal);
  }
  assert.equal(currencyDecimal('1.311999'), '1.311999');
  assert.equal(editCurrencyInput('', 0, 0, '1.311999', 6).decimal, '1.311999');
  assert.equal(editCurrencyInput('', 0, 0, '1.3119999', 6), null);
  for (const text of ['-100', 'abc', '1e6', '1,2,3']) assert.equal(currencyClipboardDecimal(text), null);
});

test('clicking padded cents edits the fraction without multiplying the whole amount', () => {
  const beforeFirstCent = currencyEditableDecimal('1500', 9);
  assert.equal(beforeFirstCent, '1500.');
  assert.equal(editCurrencyInput(beforeFirstCent, 5, 5, '5', 2).decimal, '1500.5');
  const beforeSecondCent = currencyEditableDecimal('1500', 10);
  assert.equal(beforeSecondCent, '1500.0');
  assert.equal(editCurrencyInput(beforeSecondCent, 6, 6, '5', 2).decimal, '1500.05');
  const atEnd = currencyEditableDecimal('1500', 11);
  assert.equal(atEnd, '1500.00');
  assert.equal(editCurrencyInput(atEnd, 7, 7, '5', 2), null);
});
