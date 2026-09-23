-- A quotation keeps an immutable copy of every equivalent reference. The
-- catalog reference can therefore be removed without breaking the historical
-- quotation; only the optional pointer to the live catalog row is cleared.
ALTER TABLE public.billing_quotation_items
 DROP CONSTRAINT billing_quotation_items_material_variant_fk,
 ADD CONSTRAINT billing_quotation_items_material_variant_fk
 FOREIGN KEY(owner_id,material_variant_id)
 REFERENCES public.billing_material_variants(owner_id,id)
 ON DELETE SET NULL (material_variant_id);
