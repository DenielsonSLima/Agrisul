-- PostgreSQL does not create indexes for referencing foreign-key columns.
-- Cover the composite quotation/order relationships used during finalization,
-- joins and protected deletes.
CREATE INDEX billing_purchase_orders_quote_provider
 ON public.billing_purchase_orders(owner_id,quotation_id,quotation_provider_id);

CREATE INDEX billing_purchase_order_items_order_quote
 ON public.billing_purchase_order_items(owner_id,purchase_order_id,quotation_id);

CREATE INDEX billing_purchase_order_items_quotation_item
 ON public.billing_purchase_order_items(owner_id,quotation_id,quotation_item_id);
