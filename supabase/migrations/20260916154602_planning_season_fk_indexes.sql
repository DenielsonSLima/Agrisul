CREATE INDEX billing_planning_field_logs_farm_plot
 ON public.billing_planning_field_logs(owner_id,farm_id,plot_id);

CREATE INDEX billing_planning_field_logs_practice
 ON public.billing_planning_field_logs(owner_id,practice_id);

CREATE INDEX billing_planning_harvest_plots_farm_plot
 ON public.billing_planning_harvest_plots(owner_id,farm_id,plot_id);
