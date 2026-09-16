CREATE INDEX billing_planning_periods_culture
 ON public.billing_planning_periods(owner_id,culture_id,culture_subtype_id);

CREATE INDEX billing_planning_allocations_farm
 ON public.billing_planning_allocations(owner_id,farm_id);

CREATE INDEX billing_planning_allocation_practices_practice
 ON public.billing_planning_allocation_practices(owner_id,practice_id);

CREATE INDEX billing_planning_history_allocation
 ON public.billing_planning_history(owner_id,allocation_id);
