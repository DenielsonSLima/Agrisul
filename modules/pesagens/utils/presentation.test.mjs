import test from 'node:test';
import assert from 'node:assert/strict';
import {exportWeighingCsv, weightInput, weightLabel} from './presentation.ts';

test('editing preserves database decimals and missing weights remain pending', () => {
  assert.equal(weightInput('16680.123456'), '16680,123456');
  assert.equal(weightInput('0'), '0');
  assert.equal(weightInput(null), '');
  assert.equal(weightLabel('27245.0000005'), '27.245,0000005');
  assert.equal(weightLabel(null), 'Pendente');
  assert.equal(weightLabel('0'), '0');
});

test('CSV preserves decimal scale and negative differences for Brazilian Excel and neutralizes text formulas', async () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let blob;
  URL.createObjectURL = value => {blob = value; return 'blob:weighing-test';};
  URL.revokeObjectURL = () => {};
  globalThis.document = {createElement: () => ({click() {}})};
  const summary = {agrisulNetKg: '57040', partnerNetKg: '56460', differenceKg: '-580'};
  try {
    exportWeighingCsv({
      control: {partnerName: '=SUM(A1:A2)', season: '2026/2027', startDate: '2026-10-16'},
      summary,
      entries: [{weighedAt: '2026-10-16', weighedTime: '18:07', ticket: '+danger', ...summary,
        components: [{fleetNumber: '133', plate: 'ABC1D23', kind: 'truck', tareKg: '16400.123456', grossKg: '38860', netKg: '22459.876544', partnerNetKg: '22710', differenceKg: '250.123456'}]}],
    });
    const csv = await blob.text();
    assert.ok(csv.includes('"16400,123456"'));
    assert.ok(csv.includes('"-580"'));
    assert.ok(!csv.includes('"\'-580"'), 'Numeric differences must remain numbers.');
    assert.ok(csv.includes('"\'=SUM(A1:A2)"'));
    assert.ok(csv.includes('"\'+danger"'));
    assert.ok(csv.includes('"TOTAL"'));
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    // The download schedules revocation; retain the stub until that callback has run.
    setTimeout(() => {URL.revokeObjectURL = originalRevoke;}, 1100);
  }
});
