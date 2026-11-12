import assert from 'node:assert/strict';

// Real page + confirmations + RPC/mutation lifecycle, with an in-memory server.
export async function verifyOvertimeRecovery({page,fixtureUrl}){
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route(/^https?:/,route=>{requests.push(route.request().url());return route.abort();});
 const monthly=()=>page.locator('.overtime-editor'),daily=()=>page.locator('.overtime-daily-editor');
 const notes=()=>monthly().locator('textarea.overtime-notes-input');
 const reason=()=>daily().getByLabel('Motivo de 26/10/2026',{exact:true});
 const retry=scope=>scope.getByRole('button',{name:'Reconsultar e tentar salvar',exact:true});
 const reset=async()=>{await page.goto(fixtureUrl);await monthly().waitFor();};
 const count=()=>page.evaluate(()=>window.overtimeRecovery.writes.length);
 const committed=()=>page.evaluate(()=>window.overtimeRecovery.commits.length);
 const waitMonthlySaved=()=>page.waitForFunction(()=>document.querySelector('.overtime-auto-save-status')?.textContent==='Alterações salvas automaticamente.');
 const waitDailySaved=()=>page.waitForFunction(()=>document.querySelector('.overtime-daily-actions [role=status]')?.textContent==='Lançamentos salvos.');
 const openDaily=async()=>{await monthly().locator('.overtime-employee-open').filter({hasText:'ANA TESTE'}).click();await daily().waitFor();};
 const failNext=async(mode='network')=>page.evaluate(mode=>{window.overtimeRecovery.failNextWrite=mode;},mode);
 const editDaily=async value=>{await reason().fill(value);await daily().getByRole('button',{name:'Salvar lançamentos',exact:true}).click();await retry(daily()).waitFor();};

 await reset();await failNext();await notes().fill('Rascunho mensal mantido');await retry(monthly()).waitFor();
 await notes().evaluate(node=>{node.dataset.retained='yes';});
 await page.evaluate(async()=>{window.overtimeRecovery.readFailures.get=503;await window.overtimeRecovery.refresh();});
 assert.equal(await notes().inputValue(),'Rascunho mensal mantido');assert.equal(await notes().getAttribute('data-retained'),'yes','Monthly editor instance survives refetch503');
 await page.evaluate(async()=>{window.overtimeRecovery.readFailures={};await window.overtimeRecovery.refresh();});
 await retry(monthly()).click();await waitMonthlySaved();assert.equal(await count(),2);assert.equal(await committed(),1);
 assert.equal(await page.evaluate(()=>window.overtimeRecovery.report().notes),'Rascunho mensal mantido');

 await reset();await openDaily();await reason().fill('Rascunho diário mantido');await reason().evaluate(node=>{node.dataset.retained='yes';});
 await page.evaluate(async()=>{window.overtimeRecovery.readFailures={'daily-get':503,get:503};await window.overtimeRecovery.refresh();});
 assert.equal(await reason().inputValue(),'Rascunho diário mantido');assert.equal(await reason().getAttribute('data-retained'),'yes','Daily editor instance survives both parent and own refetch503');
 await page.evaluate(async()=>{window.overtimeRecovery.readFailures={};await window.overtimeRecovery.refresh();});
 await failNext();await daily().getByRole('button',{name:'Salvar lançamentos',exact:true}).click();await retry(daily()).waitFor();
 assert.equal(await reason().inputValue(),'Rascunho diário mantido');await retry(daily()).click();await waitDailySaved();assert.equal(await count(),2);assert.equal(await committed(),1);

 await reset();await page.evaluate(()=>window.overtimeRecovery.changeReport({sector:'Setor remoto'}));await notes().fill('Observação local');await retry(monthly()).waitFor();
 await retry(monthly()).click();await waitMonthlySaved();
 assert.deepEqual(await page.evaluate(()=>{const report=window.overtimeRecovery.report();return {sector:report.sector,notes:report.notes,revision:window.overtimeRecovery.writes[1].payload.expectedUpdatedAt};}),{sector:'Setor remoto',notes:'Observação local',revision:'1'});

 await reset();await page.evaluate(()=>window.overtimeRecovery.changeReport({notes:'Observação remota'}));await notes().fill('Observação local em conflito');await retry(monthly()).waitFor();await retry(monthly()).click();
 await monthly().getByRole('button',{name:'Carregar versão atual',exact:true}).waitFor();assert.equal(await notes().inputValue(),'Observação local em conflito');assert.equal(await count(),1);
 await monthly().getByRole('button',{name:'Carregar versão atual',exact:true}).click();const confirmation=page.getByRole('alertdialog');await confirmation.getByRole('button',{name:'Cancelar',exact:true}).click();
 assert.equal(await notes().inputValue(),'Observação local em conflito');assert.equal(await committed(),0);
 await monthly().getByRole('button',{name:'Carregar versão atual',exact:true}).click();await confirmation.getByRole('button',{name:'Carregar versão atual',exact:true}).click();await waitMonthlySaved();
 assert.equal(await notes().inputValue(),'Observação remota');assert.equal(await committed(),0);

 await reset();await failNext('commit-lost');await notes().fill('Commit mensal confirmado');await retry(monthly()).waitFor();assert.equal(await committed(),1);
 await retry(monthly()).click();await waitMonthlySaved();assert.equal(await count(),1,'Lost monthly response must not replay committed write');assert.equal(await notes().inputValue(),'Commit mensal confirmado');

 await reset();await failNext('commit-lost-pending');await notes().fill('Primeira edição em voo');
 await page.waitForFunction(()=>window.overtimeRecovery.releaseWrite!==null);
 await notes().fill('Segunda edição no mesmo campo durante o envio');
 await page.evaluate(()=>window.overtimeRecovery.releaseWrite());await retry(monthly()).waitFor();
 assert.equal(await notes().inputValue(),'Segunda edição no mesmo campo durante o envio');assert.equal(await committed(),1);
 await retry(monthly()).click();await waitMonthlySaved();
 assert.equal(await page.evaluate(()=>window.overtimeRecovery.report().notes),'Segunda edição no mesmo campo durante o envio');assert.equal(await count(),2);assert.equal(await committed(),2,'Only the newer unsaved draft is written after recognizing the ambiguous first commit');

 await reset();await openDaily();await page.evaluate(()=>window.overtimeRecovery.changeDaily('employee-one','2026-10-27',{reason:'Dia independente remoto'}));await editDaily('Motivo local em dia diferente');
 await retry(daily()).click();await waitDailySaved();assert.equal(await count(),2);assert.equal(await committed(),1);
 assert.deepEqual(await page.evaluate(()=>window.overtimeRecovery.report().rows[0].daily.entries.map(day=>[day.date,day.reason])),[['2026-10-26','Motivo local em dia diferente'],['2026-10-27','Dia independente remoto']]);

 await reset();await openDaily();await page.evaluate(()=>window.overtimeRecovery.changeDaily('employee-one','2026-10-26',{reason:'Motivo remoto em conflito'}));await editDaily('Motivo local em conflito');await retry(daily()).click();
 await daily().getByRole('button',{name:'Carregar versão atual',exact:true}).waitFor();assert.equal(await count(),1);assert.equal(await reason().inputValue(),'Motivo local em conflito');
 await daily().getByRole('button',{name:'Carregar versão atual',exact:true}).click();await confirmation.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(await reason().inputValue(),'Motivo local em conflito');
 await daily().getByRole('button',{name:'Carregar versão atual',exact:true}).click();await confirmation.getByRole('button',{name:'Carregar versão atual',exact:true}).click();await waitDailySaved();
 assert.equal(await reason().inputValue(),'Motivo remoto em conflito');assert.equal(await committed(),0);

 await reset();await openDaily();await failNext('commit-lost');await editDaily('Commit diário confirmado');assert.equal(await committed(),1);
 await retry(daily()).click();await waitDailySaved();assert.equal(await count(),1,'Lost daily response must not replay committed write');assert.equal(await reason().inputValue(),'Commit diário confirmado');

 await reset();await openDaily();await failNext('commit-lost');await editDaily('Primeira alteração diária confirmada');
 await reason().fill('Nova alteração no mesmo dia após resposta perdida');await retry(daily()).click();await waitDailySaved();
 assert.equal(await reason().inputValue(),'Nova alteração no mesmo dia após resposta perdida');assert.equal(await count(),2);assert.equal(await committed(),2);

 await reset();await monthly().getByRole('button',{name:'Remover linha 2',exact:true}).click();await confirmation.getByRole('button',{name:'Remover funcionário',exact:true}).click();
 await page.evaluate(()=>window.overtimeRecovery.changeDaily('employee-two','2026-10-27',{reason:'Lançamento concorrente preservado'}));await retry(monthly()).waitFor();await retry(monthly()).click();
 await monthly().getByRole('button',{name:'Carregar versão atual',exact:true}).waitFor();assert.equal(await count(),1);assert.equal(await committed(),0);
 assert.equal(await page.evaluate(()=>window.overtimeRecovery.report().rows.find(row=>row.employeeId==='employee-two').daily.entries[0].reason),'Lançamento concorrente preservado');

 await reset();await openDaily();await reason().fill('Rascunho sem acesso');
 await page.evaluate(async()=>{window.overtimeRecovery.readFailures={get:403,'daily-get':403};await window.overtimeRecovery.refresh();});
 await monthly().waitFor({state:'detached'});assert.equal(await daily().count(),0);assert.equal(await page.getByLabel('Motivo de 26/10/2026',{exact:true}).count(),0);assert.equal(await count(),0);

 await reset();await openDaily();await reason().fill('SEGREDO_DO_RASCUNHO_ANTERIOR');await page.evaluate(()=>window.overtimeRecovery.switchActor('owner-two'));
 await daily().waitFor({state:'detached'});await monthly().waitFor();assert.equal(await notes().inputValue(),'Observação da outra conta');
 assert.equal(await page.getByText('SEGREDO_DO_RASCUNHO_ANTERIOR',{exact:true}).count(),0);assert.equal(await count(),0,'Switching accounts cannot flush the previous account draft');

 await reset();await failNext();await notes().fill('RASCUNHO_MENSAL_DA_CONTA_ANTERIOR');await retry(monthly()).waitFor();
 await page.evaluate(()=>window.overtimeRecovery.switchActor('owner-two'));await page.waitForFunction(()=>document.querySelector('textarea.overtime-notes-input')?.value==='Observação da outra conta');
 assert.equal(await count(),1,'Switching accounts cannot retry the previous account paused write');

 assert.deepEqual(errors,[],'No browser runtime errors');assert.deepEqual(requests,[],'Fixture never accesses remote HTTP services');
 console.log('PASS overtime recovery browser: same cached editor nodes survive503; explicit retries preserve input; independent23514 changes merge; conflicts require confirmed discard; lost responses do not duplicate writes or discard later typing; concurrent daily additions block employee deletion;403 blocks editing; account switch clears monthly and daily drafts.');
}
