import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Explicit live runner only: sessions remain in memory and use ephemeral accounts.
export async function verifyDailyOvertimeBrowser({directory,ref,session,report,employee,rpc}){
 const {chromium}=await import('../.sites-runtime/browser-tools/node_modules/playwright/index.mjs');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.addInitScript(({key,session})=>{if(location.protocol==='http:'&&location.hostname==='127.0.0.1')localStorage.setItem(key,JSON.stringify(session));},{key:`sb-${ref}-auth-token`,session});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 page.setDefaultTimeout(45000);
 try{
  await page.goto(`http://127.0.0.1:5173/solicitacoes?secao=horas-extras&relatorio=${report.id}`,{timeout:90000});
  const editor=page.locator('.overtime-editor');await editor.waitFor();
  assert.equal(await page.locator('.pdf-export-preview').count(),0,'No document preview in employee list');
  assert.equal(await editor.locator('tbody input').count(),0,'Monthly quantities are no longer editable');
  await editor.locator('.overtime-employee-open').filter({hasText:employee.fullName}).click();
  const daily=page.locator('.overtime-daily-modal');await daily.locator('.overtime-daily-editor').waitFor();
  assert.equal(await daily.locator('tbody tr').count(),31);
  await daily.getByLabel('Inicial de 28/10/2026',{exact:true}).fill('08:00:00');
  await daily.getByLabel('Final de 28/10/2026',{exact:true}).fill('10:00:00');
  await daily.getByRole('textbox',{name:'Motivo de 28/10/2026',exact:true}).fill('Conferência pelo navegador');
  await daily.getByRole('button',{name:'Salvar lançamentos',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.overtime-daily-actions [role=status]')?.textContent==='Lançamentos salvos.');
  const saved=await rpc('daily-get',{companyId:report.companyId,id:report.id,employeeId:employee.id});
  assert.equal(saved.daily.calculated50,'12:30:00');assert.equal(saved.daily.total50,'11:00:00','Adjustment stays explicit while daily calculation changes');
  await daily.getByRole('button',{name:'Exportar individual',exact:true}).click();
  const preview=page.locator('.pdf-export-modal');await preview.locator('iframe').waitFor();
  const download=page.waitForEvent('download');await preview.getByRole('button',{name:'Baixar PDF',exact:true}).click();
  const file=await download;const path=resolve(directory,'daily-browser.pdf');await file.saveAs(path);
  assert.equal(readFileSync(path).subarray(0,4).toString(),'%PDF');
  await page.screenshot({path:resolve(directory,'daily-export-desktop.png'),fullPage:true});
  await preview.getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(250);
  const bounds=await daily.evaluate(node=>{const rect=node.getBoundingClientRect();return {left:rect.left,right:rect.right,width:innerWidth,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};});
  assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.scrollWidth<=bounds.clientWidth+1,'Mobile dialog contains its horizontal overflow: '+JSON.stringify(bounds));
  await daily.evaluate(node=>{node.scrollTop=0;node.scrollLeft=0;});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile editor fits viewport');
  await page.screenshot({path:resolve(directory,'daily-editor-mobile.png'),fullPage:true});
  await daily.getByRole('button',{name:'Fechar',exact:true}).click();
  await page.reload();await editor.waitFor();
  assert.ok((await editor.textContent()).includes('11:00:00'));
  assert.deepEqual(errors,[],'No browser runtime errors');
  console.log('PASS browser: employee list, complete daily calendar, save through RPC, adjusted and calculated totals, PDF preview/download and mobile layout.');
 }finally{await context.close();await browser.close();}
}
