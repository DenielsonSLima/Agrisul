import assert from 'node:assert/strict';

// Uses the real RPC deadline, import hooks, TanStack lifecycle and cell editor.
// The host replaces only AuthProvider/client and shortens the deadline to 250 ms.
export async function verifyImportSaveRecovery({page,fixtureUrl}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const cell=id=>page.locator(`[data-entry-id="${id}"][data-field-key="COD_TALHAO"]`);
 const active=id=>page.waitForFunction(id=>document.activeElement?.matches('input')&&document.activeElement.dataset.entryId===id&&!document.activeElement.readOnly,id);
 const reset=async mode=>{await page.goto(fixtureUrl);await cell('row-one').waitFor();await page.evaluate(mode=>{window.importRecovery.mode=mode;},mode);};
 const save=async()=>{await cell('row-one').click();await cell('row-one').fill('5');await cell('row-one').press('Enter');};
 const released=async()=>{
  await page.locator('[role="alert"]').waitFor();
  await page.waitForFunction(()=>document.querySelector('#mutation-status').textContent==='idle');
  assert.equal(await cell('row-one').inputValue(),'5');assert.equal(await cell('row-one').evaluate(node=>node.readOnly),false);
  assert.equal(await page.locator('[data-saving=true]').count(),0);
 };

 await reset('normal');
 await cell('row-one').click();await cell('row-one').fill('5');
 await page.evaluate(async()=>{window.importRecovery.changeOtherRow();await window.importRecovery.refresh();});
 await page.waitForFunction(()=>document.querySelector('#revision').textContent==='1');
 await cell('row-one').press('Enter');await active('row-two');
 assert.equal(await page.evaluate(()=>window.importRecovery.writes[0].revision),'1','An open draft must use the refreshed revision when its value did not change remotely');
 assert.equal(await page.locator('[role="alert"]').count(),0);

 await reset('normal');await cell('row-one').click();await cell('row-one').fill('5');
 await page.evaluate(async()=>{window.importRecovery.mode='lagging-metadata';window.importRecovery.changeOtherRow();await window.importRecovery.refresh();});
 await page.waitForFunction(()=>document.querySelector('#table-revision').textContent==='1');
 assert.equal(await page.locator('#revision').textContent(),'0','Metadata is deliberately older than the displayed rows');
 await cell('row-one').press('Enter');await active('row-two');
 assert.equal(await page.evaluate(()=>window.importRecovery.writes[0].revision),'1');
 await cell('row-two').fill('6');await cell('row-two').press('Enter');await active('row-three');
 assert.equal(await page.evaluate(()=>window.importRecovery.writes[1].revision),'2');

 await reset('normal');
 await cell('row-one').click();await cell('row-one').fill('5');
 await page.evaluate(async()=>{window.importRecovery.changeCurrentRow();await window.importRecovery.refresh();});
 await page.waitForFunction(()=>document.querySelector('#revision').textContent==='1');
 await cell('row-one').press('Enter');await page.locator('[role="alert"]').waitFor();
 assert.match(await page.locator('[role="alert"]').textContent(),/valor desta célula mudou/);
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),0,'A refreshed revision must never authorize overwriting a changed cell');

 await reset('normal');await cell('row-one').click();await cell('row-one').fill('5');
 await page.evaluate(()=>{window.importRecovery.mode='realtime-stream';void window.importRecovery.refresh();});
 assert.equal(await cell('row-one').evaluate(node=>node.readOnly),false,'Background Realtime reads must not lock an already displayed row');
 await cell('row-one').press('Enter');await active('row-two');
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),1,'Enter during a background read must save rather than disappear');

 await reset('hang-write');await save();await released();
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),1);
 assert.ok(await page.evaluate(()=>window.importRecovery.aborts)>=1);
 await page.evaluate(()=>{window.importRecovery.releaseWrite?.();window.importRecovery.mode='normal';window.importRecovery.changeOtherRow();});
 await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#revision').textContent==='1');
 await cell('row-one').fill('6');await cell('row-one').press('Enter');await active('row-two');
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),2);
 assert.equal(await page.evaluate(()=>window.importRecovery.writes[1].revision),'1','An amended draft retries against the reconciled revision when this cell was unchanged');

 await reset('hang-session');await save();await released();
 await page.evaluate(()=>{window.importRecovery.mode='normal';window.importRecovery.releaseSession?.();});
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),0,'An expired session check cannot dispatch a late write');
 await cell('row-one').press('Enter');await active('row-two');

 await reset('commit-without-response');await save();await released();
 assert.equal(await page.locator('#revision').textContent(),'1','Ambiguous commit is reread before releasing the cell');
 await cell('row-one').press('Enter');
 assert.match(await page.locator('[role="alert"]').textContent(),/valor desta célula mudou/);
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),1,'Retry must not silently overwrite changed server data');
 await page.evaluate(()=>{window.importRecovery.mode='normal';});
 await cell('row-one').press('Escape');assert.equal(await cell('row-one').textContent(),'5');
 await cell('row-two').click();await cell('row-two').fill('6');await cell('row-two').press('Enter');await active('row-three');

 await reset('normal');await page.evaluate(()=>window.importRecovery.setOnline(false));await save();await released();
 await page.evaluate(()=>window.importRecovery.setOnline(true));
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),1,'Reconnect cannot run a queued write');
 await cell('row-one').press('Enter');await active('row-two');

 await reset('normal');await page.evaluate(()=>{window.importRecovery.mode='hang-refresh';});await save();await released();
 assert.match(await page.locator('[role="alert"]').textContent(),/alteração foi salva/);
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),1,'A refresh failure cannot repeat the successful write');
 await page.evaluate(()=>{window.importRecovery.mode='normal';});await page.locator('#refresh').click();
 await page.waitForFunction(()=>document.querySelector('#revision').textContent==='1');
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),1,'Refreshing data must not resubmit the failed draft on blur');
 await cell('row-one').press('Escape');await cell('row-two').click();await cell('row-two').fill('6');await cell('row-two').press('Enter');await active('row-three');
 await reset('realtime-stream');await save();await active('row-two');
 assert.equal(await page.locator('[role="alert"]').count(),0,'Row events must not cancel the mutation refresh until its deadline');
 assert.equal(await page.locator('#revision').textContent(),'1');
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),1);
 assert.equal(await page.evaluate(()=>window.importRecovery.aborts),0,'Realtime must reuse the running reads');
 await cell('row-two').fill('6');await cell('row-two').press('Enter');await active('row-three');
 assert.equal(await page.evaluate(()=>window.importRecovery.writes.length),2);
 assert.equal(await page.evaluate(()=>window.importRecovery.writes[1].revision),'1');
 assert.equal(await page.locator('[data-saving=true]').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: open drafts accept newer table revisions without overwriting changed cells; stale metadata cannot supply write revisions; stalled RPC/session/refetch release saving; no write replay.');
}
