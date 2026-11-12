-- Page KPIs use the same exact persisted durations as the monthly report.
DO $migration$
DECLARE definition text; marker text := $marker$'total50',billing_private.overtime_hours(p_row.seconds_50)$marker$;
BEGIN
 definition=pg_get_functiondef('billing_private.overtime_daily_json(public.billing_overtime_rows)'::regprocedure);
 IF strpos(definition,marker)=0 OR strpos(definition,'''totalHours''')>0 THEN
  RAISE EXCEPTION 'Review the daily projection before adding employee page KPIs.';
 END IF;
 definition=replace(definition,marker,$replacement$'totalHours',billing_private.overtime_hours(p_row.seconds_50+p_row.seconds_100),
  'entryCount',(SELECT count(*) FROM public.billing_overtime_daily_entries e WHERE e.owner_id=p_row.owner_id AND e.report_id=p_row.report_id AND e.employee_id=p_row.employee_id),
  'total50',billing_private.overtime_hours(p_row.seconds_50)$replacement$);
 EXECUTE definition;
END $migration$;
