import assert from 'node:assert/strict';

// Exercise the whole overtime module with touch viewport sizes, including drafts
// on different dates and both rates on one date. Only fixture transport is fake.
export async function verifyOvertimeTouch({page,fixtureUrl,screenshotDirectory}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const listUrl=new URL(fixtureUrl);listUrl.searchParams.delete('relatorio');
 const fit=async(label)=>{
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,nodes:[...document.querySelectorAll('#root *')].filter(node=>node.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(node=>({tag:node.tagName,class:node.className,right:node.getBoundingClientRect().right}))}));
  if(overflow.scroll>overflow.width&&screenshotDirectory)await page.screenshot({path:`${screenshotDirectory}/touch-overflow.png`,fullPage:true});
  assert.ok(overflow.scroll<=overflow.width,label+' fits without horizontal page scrolling: '+JSON.stringify(overflow));
 };
 for(const viewport of [{width:360,height:800},{width:390,height:844},{width:768,height:1024},{width:1024,height:768}]){
  await page.setViewportSize(viewport);await page.goto(listUrl.toString());await page.locator('.overtime-report-grid').waitFor();await fit('List');
  await page.locator('.overtime-report-card').first().click();const monthly=page.locator('.overtime-editor');await monthly.waitFor();await fit('Monthly report');
  await monthly.locator('.overtime-employee-open').filter({hasText:'ANA TESTE'}).click();
  const screen=page.locator('.overtime-employee-page'),form=screen.locator('.overtime-daily-editor');await form.waitFor();await fit('Daily page');
  const selector=form.getByLabel('Dia dos lançamentos',{exact:true});await selector.selectOption('2026-10-26');
  await form.getByRole('button',{name:'Adicionar período 100%',exact:true}).click();
  assert.equal(await form.locator('.overtime-period-card').count(),2);
  await form.getByLabel('Inicial de 26/10/2026, período 2',{exact:true}).fill('09:00:00');
  await form.getByLabel('Final de 26/10/2026, período 2',{exact:true}).fill('11:00:00');
  await form.getByLabel('Motivo de 26/10/2026, período 2',{exact:true}).fill('Segundo período a 100%');
  assert.equal(await form.getByLabel('Tipo de hora extra de 26/10/2026, período 2',{exact:true}).inputValue(),'100');
  await selector.selectOption('2026-10-28');
  await form.getByLabel('Inicial de 28/10/2026, período 1',{exact:true}).fill('18:00:00');
  await form.getByLabel('Final de 28/10/2026, período 1',{exact:true}).fill('19:00:00');
  await form.getByLabel('Motivo de 28/10/2026, período 1',{exact:true}).fill('Outro dia mantido no rascunho');
  await selector.selectOption('2026-10-26');
  assert.equal(await form.getByLabel('Motivo de 26/10/2026, período 2',{exact:true}).inputValue(),'Segundo período a 100%');
  assert.equal(await form.getByLabel('Motivo de 26/10/2026, período 1',{exact:true}).inputValue(),'Motivo original');
  await form.getByRole('button',{name:'Salvar lançamentos',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.overtime-daily-actions [role=status]')?.textContent==='Lançamentos salvos.');
  assert.equal(await screen.getByLabel('Total de horas do funcionário',{exact:true}).textContent(),'04:00:00');
  assert.equal(await screen.getByLabel('Horas extras 50% do funcionário',{exact:true}).textContent(),'02:00:00');
  assert.equal(await screen.getByLabel('Horas extras 100% do funcionário',{exact:true}).textContent(),'02:00:00');
  assert.equal(await screen.getByLabel('Dias lançados do funcionário',{exact:true}).textContent(),'2');
  assert.deepEqual(await page.evaluate(()=>window.overtimeRecovery.report().rows[0].daily.entries.map(entry=>entry.rate)),['50','100','50']);
  await fit('Mixed periods');
  for(const name of ['Dia anterior','Próximo dia','Adicionar período 50%','Adicionar período 100%']){
   const control=form.getByRole('button',{name,exact:true}),box=await control.boundingBox();
   assert.ok(box&&box.width>=44&&box.height>=44,'Touch target '+name+' at '+viewport.width);
  }
  await screen.evaluate(node=>node.scrollIntoView({block:'start'}));
  if(screenshotDirectory)await page.screenshot({path:`${screenshotDirectory}/touch-${viewport.width}.png`,fullPage:true});
  await screen.getByRole('link',{name:'Voltar para o relatório mensal',exact:true}).click();await monthly.waitFor();
  await monthly.locator('.overtime-employee-open').filter({hasText:'ANA TESTE'}).click();await form.waitFor();await selector.selectOption('2026-10-26');
  assert.equal(await form.locator('.overtime-period-card').count(),2,'Both saved rates survive leaving and reopening the employee');
 }
 await page.goto(listUrl.toString());await page.locator('.overtime-report-grid').waitFor();
 await page.evaluate(async()=>{
  const state=window.overtimeRecovery,report=state.report(),entries=[];
  for(let day=0;day<60;day++){
   const cursor=new Date('2025-12-31T12:00:00Z');cursor.setUTCDate(cursor.getUTCDate()+day);
   for(let period=0;period<8;period++)entries.push({id:crypto.randomUUID(),date:cursor.toISOString().slice(0,10),startTime:String(period).padStart(2,'0')+':00:00',endTime:String(period+1).padStart(2,'0')+':00:00',breakStart:'',breakEnd:'',breakDuration:'00:00:00',rate:period%2?'100':'50',reason:'Período preservado',approval:''});
  }
  entries.push({id:crypto.randomUUID(),date:'2026-12-31',startTime:'18:00:00',endTime:'19:00:00',breakStart:'',breakEnd:'',breakDuration:'00:00:00',rate:'100',reason:'Último dia preservado',approval:''});
  report.rows[0].daily.entries=entries;state.changeReport({dateFrom:'2025-12-31',dateTo:'2026-12-31',rows:report.rows});await state.refresh();
 });
 await page.locator('.overtime-report-card').first().click();await page.locator('.overtime-editor').waitFor();await page.locator('.overtime-employee-open').filter({hasText:'ANA TESTE'}).click();
 const form=page.locator('.overtime-daily-editor'),selector=form.getByLabel('Dia dos lançamentos',{exact:true});await form.waitFor();assert.equal(await selector.locator('option').count(),366);
 await selector.selectOption('2026-12-31');assert.equal(await form.getByLabel('Motivo de 31/12/2026, período 1',{exact:true}).inputValue(),'Último dia preservado');
 await form.getByLabel('Motivo de 31/12/2026, período 1',{exact:true}).fill('Último dia conferido');await form.getByRole('button',{name:'Salvar lançamentos',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.overtime-daily-actions [role=status]')?.textContent==='Lançamentos salvos.');
 assert.equal(await page.evaluate(()=>window.overtimeRecovery.report().rows[0].daily.entries.length),481,'Calendar retains every period across all 366 dates');
 assert.deepEqual(errors,[]);console.log('PASS overtime touch: list/monthly/daily at 360,390,768,1024px, both rates per day, drafts across dates, server KPIs, reopened employee, 44px targets and all 366 dates preserved with 481 periods.');
}
