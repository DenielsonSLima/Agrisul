-- Plots are identified by the name entered in their farm, including PDF
-- identifiers such as 3 or A. Keep existing names, ownership and uniqueness.
ALTER TABLE public.billing_farm_plots
 DROP CONSTRAINT billing_farm_plots_name_check,
 ADD CONSTRAINT billing_farm_plots_name_check CHECK (length(name) BETWEEN 1 AND 150);
