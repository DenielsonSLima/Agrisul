import assert from 'node:assert/strict';

export async function verifyPartnerDestinationForm({page,fixtureUrl}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(fixtureUrl);const destination=page.locator('input[name=destinationCode]');
 assert.equal(await destination.inputValue(),'00008');
 await destination.fill('00019');await page.getByRole('button',{name:'Consultar CNPJ',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[name=legalName]').value==='Parceiro consultado');
 assert.equal(await destination.inputValue(),'00019','CNPJ lookup preserves the partner-only code');
 await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
 await page.waitForFunction(()=>window.partnerDestinationFixture.saved.length===1&&window.partnerDestinationFixture.navigated);
 const payload=await page.evaluate(()=>window.partnerDestinationFixture.saved[0]);
 assert.equal(payload.destinationCode,'00019');assert.equal(payload.id,'partner-one');
 assert.equal('createdAt' in payload,false);assert.equal('updatedAt' in payload,false);
 assert.deepEqual(await page.evaluate(()=>window.partnerDestinationFixture.notifications),['updated']);
 await page.evaluate(()=>{window.partnerDestinationFixture.fail=true;});
 await destination.fill('8');await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
 await page.locator('.form-error').waitFor();
 assert.equal(await destination.inputValue(),'8');
 assert.deepEqual(await page.evaluate(()=>window.partnerDestinationFixture.notifications),['updated','error']);
 assert.equal(await page.getByRole('button',{name:'Salvar alterações',exact:true}).isEnabled(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: destination field preserves leading zeros and CNPJ draft; save sends only allowed fields; server failure retains draft, releases form and reports once.');
}
