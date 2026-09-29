import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const pagePath=new URL('../modules/pedidos/components/PedidosPage.tsx',import.meta.url);
const migrationPath=new URL('../supabase/migrations/20260929130228_purchase_order_optional_contact.sql',import.meta.url);

test('purchase orders keep contacts optional and expose registered contacts clearly',async()=>{
  const [source,migration]=await Promise.all([
    readFile(pagePath,'utf8'),
    readFile(migrationPath,'utf8'),
  ]);
  const start=source.indexOf('function PurchaseOrderDetail(');
  const detail=source.slice(start,source.indexOf('\nfunction ',start+1));

  assert.notEqual(start,-1);
  assert.doesNotMatch(detail,/purchaseOrderNumber\.trim\(\)&&!form\.providerContactId/);
  assert.match(detail,/Contato responsável pela OC \(opcional\)/);
  assert.match(detail,/currentContacts\.length\?`Selecionar contato \(\$\{currentContacts\.length\}/);
  assert.match(detail,/value=\{form\.providerContactId\?\?''\}/);
  assert.match(detail,/Opcional — o pedido pode ser salvo normalmente/);

  assert.doesNotMatch(migration,/Selecione (?:e salve )?o contato responsável pela ordem de compra/);
  assert.match(migration,/provider_id=v_order\.provider_id[\s\S]*id=v_provider_contact_id AND deleted_at IS NULL FOR SHARE/);
});

test('a payment method can be created and selected without leaving the order draft',async()=>{
  const [source,formSource]=await Promise.all([
    readFile(pagePath,'utf8'),
    readFile(new URL('../modules/cadastro/formas-pagamento/components/PaymentMethodForm.tsx',import.meta.url),'utf8'),
  ]);
  const start=source.indexOf('function PurchaseOrderDetail(');
  const detail=source.slice(start,source.indexOf('\nfunction ',start+1));

  assert.match(detail,/usePaymentMethodMutations\(\)/);
  assert.match(detail,/<button className="btn purchase-order-payment-method-add" type="button" aria-label="Cadastrar nova forma de pagamento"/);
  assert.match(detail,/creatingPaymentMethod&&<PaymentMethodForm/);

  const commercialStart=detail.indexOf('<form className="purchase-order-panel purchase-order-commercial"');
  const commercialEnd=detail.indexOf('</form>',commercialStart);
  const modalAt=detail.indexOf('{creatingPaymentMethod&&<PaymentMethodForm');
  assert.ok(commercialStart>=0&&commercialEnd>commercialStart&&modalAt>commercialEnd,'the nested dialog must remain outside the purchase-order form');

  const saveAt=detail.indexOf('const saved=await paymentMethodMutations.save(input)');
  const selectAt=detail.indexOf("set('paymentMethodId',saved.id)",saveAt);
  const feedbackAt=detail.indexOf('notifications.created(',selectAt);
  const closeAt=detail.indexOf('setCreatingPaymentMethod(false)',feedbackAt);
  assert.ok(saveAt>=0&&selectAt>saveAt&&feedbackAt>selectAt&&closeAt>feedbackAt,'the returned payment method must be selected before feedback and closing');
  assert.match(formSource,/import '\.\.\/styles\.css';/);
});
