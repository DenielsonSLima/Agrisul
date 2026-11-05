import assert from 'node:assert/strict';

// Run against tests/fixtures/import-cell-keyboard.tsx bundled for the browser.
// Browser infrastructure is injected, as in the other browser regression helpers.
export async function verifyImportCellKeyboard({page,fixtureUrl}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(fixtureUrl);
 const cell=(id,key)=>page.locator(`[data-entry-id="${id}"][data-field-key="${key}"]`);
 const active=(id,key)=>page.waitForFunction(({id,key})=>document.activeElement?.matches('input')&&document.activeElement.dataset.entryId===id&&document.activeElement.dataset.fieldKey===key&&!document.activeElement.readOnly,{id,key});
 await cell('row-one','COD_TALHAO').click();await cell('row-one','COD_TALHAO').fill('17');await cell('row-one','COD_TALHAO').press('Enter');
 await active('row-two','COD_TALHAO');assert.equal(await page.evaluate(()=>window.keyboardFixture.calls.length),1);
 await cell('row-two','COD_TALHAO').fill('16');await cell('row-two','COD_TALHAO').press('Enter');await active('row-three','COD_TALHAO');
 assert.equal(await page.evaluate(()=>window.keyboardFixture.calls[1].revision),'1');
 await cell('row-three','COD_TALHAO').press('Shift+Enter');await active('row-two','COD_TALHAO');
 await cell('row-two','COD_TALHAO').press('Tab');await active('row-two','COD_DESTINO');
 await cell('row-two','COD_DESTINO').fill('00019');await cell('row-two','COD_DESTINO').press('Enter');await active('row-three','COD_DESTINO');
 const count=await page.evaluate(()=>window.keyboardFixture.calls.length);
 await cell('row-three','COD_DESTINO').press('Shift+Enter');await active('row-two','COD_DESTINO');assert.equal(await page.evaluate(()=>window.keyboardFixture.calls.length),count,'Unchanged text moves without a write');
 await cell('row-two','COD_DESTINO').press('Shift+Tab');await active('row-two','COD_TALHAO');
 await cell('row-two','COD_TALHAO').fill('invalid');await cell('row-two','COD_TALHAO').press('Enter');await page.locator('input[aria-invalid=true]').waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.entryId),'row-two');assert.equal(await page.evaluate(()=>window.keyboardFixture.calls.length),count,'Invalid input remains on current row without a write');
 await cell('row-two','COD_TALHAO').press('Escape');await cell('row-one','PESOBRUTO').click();await cell('row-one','PESOBRUTO').fill('21');await cell('row-one','PESOBRUTO').press('Enter');
 await page.locator('[data-updating=true]').waitFor();await page.locator('#outside').click();
 await page.waitForFunction(()=>document.querySelector('[data-updating]').dataset.updating==='false');assert.equal(await page.evaluate(()=>document.activeElement.id),'outside','A later pointer choice cancels pending keyboard focus');
 // Navigation is cancelled when the table unmounts.
 await cell('row-one','COD_DESTINO').click();await cell('row-one','COD_DESTINO').fill('20');await cell('row-one','COD_DESTINO').press('Enter');
 await page.goto('about:blank');assert.deepEqual(errors,[]);
 console.log('PASS: Enter/Shift+Enter after 850 ms refetch; fresh revisions; Tab/Shift+Tab; single writes; invalid drafts and Escape; pointer cancellation; unmount cleanup.');
}
