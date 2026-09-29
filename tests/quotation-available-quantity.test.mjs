import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = path => readFile(new URL(path, import.meta.url), 'utf8');

test('quotation negotiation collects and presents optional supplier availability', async () => {
  const [types, dialog, negotiation, comparison, awardPdf, negotiationPdf] = await Promise.all([
    source('../modules/cotacao/types.ts'),
    source('../modules/cotacao/components/QuotePriceDialog.tsx'),
    source('../modules/cotacao/components/QuoteNegotiationTab.tsx'),
    source('../modules/cotacao/components/QuoteComparisonTab.tsx'),
    source('../modules/cotacao/reporting/quotationAwardPdf.ts'),
    source('../modules/cotacao/reporting/quotationNegotiationPdf.ts'),
  ]);

  assert.match(types, /availableQuantity:\s*string\s*\|\s*null/);
  assert.match(types, /QuoteNegotiationInput[\s\S]*availableQuantity:\s*string/);
  assert.match(dialog, /Quantidade disponível/);
  assert.match(dialog, /quantity\s*<\s*0/);
  assert.match(dialog, /quantity\s*>\s*requestedQuantity/);
  assert.match(dialog, /availableQuantity:\s*availableQuantity\.trim\(\)/);
  assert.match(negotiation, /currentOffer\?\.availableQuantity\s*\?\?\s*item\.quantity/);
  assert.match(comparison, />Solicitada</);
  assert.match(comparison, />Disponível</);
  assert.match(comparison, /award\.availableQuantity\s*\?\?\s*item\.quantity/);
  assert.match(awardPdf, /Qtd\. aprovada/);
  assert.match(awardPdf, /item\.availableQuantity\s*\?\?\s*item\.quantity/);
  assert.match(negotiationPdf, /offer\.availableQuantity\s*\?\?\s*item\.quantity/);
});

test('Postgres owns availability limits, totals, idempotency and purchase-order quantity', async () => {
  const migration = await source('../supabase/migrations/20260929142433_quotation_available_quantity.sql');

  assert.match(migration, /billing_quotation_provider_values[\s\S]*ADD COLUMN available_quantity numeric/);
  assert.match(migration, /billing_quotation_negotiations[\s\S]*ADD COLUMN available_quantity numeric/);
  assert.match(migration, /available_quantity>=0/);
  assert.match(migration, /scale\(available_quantity\)<=3/);
  assert.match(migration, /v_available_quantity>v_requested_quantity/);
  assert.match(migration, /quotation_effective_quantity/);
  assert.match(migration, /quotation_line_total\([\s\S]*available_quantity/);
  assert.match(migration, /v_negotiation\.available_quantity IS DISTINCT FROM v_available_quantity/);
  assert.match(migration, /Do not rewrite the current offer when an older request is retried/);
  assert.match(migration, /v_previous_available_quantity IS DISTINCT FROM v_available_quantity/);
  assert.match(migration, /DELETE FROM public\.billing_quotation_item_awards/);
  assert.match(migration, /Não é possível aprovar um fornecedor sem quantidade disponível/);
  assert.match(
    migration,
    /INSERT INTO public\.billing_purchase_order_items\([\s\S]*quotation_effective_quantity\(i\.quantity,qv\.available_quantity\)/,
  );
  assert.match(migration, /SECURITY DEFINER SET search_path=''/);
  assert.match(migration, /REVOKE ALL ON FUNCTION billing_private\.quotations_dispatch/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION billing_private\.quotations_dispatch[\s\S]*TO authenticated/);
});
