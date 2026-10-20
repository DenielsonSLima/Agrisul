-- A missing measurement is unknown, not a measured zero. Empty controls keep
-- zero totals; populated periods only sum measurements that actually exist.
CREATE OR REPLACE FUNCTION billing_private.cane_summary(p_entries jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH totals AS (
  SELECT count(*) AS entry_count,
   count(*) FILTER(WHERE (e->>'agrisulComplete')::boolean AND (e->>'partnerComplete')::boolean) AS complete_count,
   CASE WHEN count(*)=0 THEN 0 ELSE sum((e->>'agrisulNetKg')::numeric) END AS agrisul,
   CASE WHEN count(*)=0 THEN 0 ELSE sum((e->>'partnerNetKg')::numeric) END AS partner,
   CASE WHEN count(*)=0 THEN 0 ELSE sum((e->>'tareKg')::numeric) END AS tare,
   CASE WHEN count(*)=0 THEN 0 ELSE sum((e->>'grossKg')::numeric) END AS gross
  FROM jsonb_array_elements(p_entries) e
 ) SELECT jsonb_build_object(
  'entryCount',entry_count,'completeCount',complete_count,'pendingCount',entry_count-complete_count,
  'agrisulNetKg',billing_private.decimal_text(agrisul),'partnerNetKg',billing_private.decimal_text(partner),
  'tareKg',billing_private.decimal_text(tare),'grossKg',billing_private.decimal_text(gross),
  'differenceKg',CASE WHEN entry_count>0 AND complete_count=entry_count THEN billing_private.decimal_text(partner-agrisul) END,
  'differencePercent',CASE WHEN entry_count>0 AND complete_count=entry_count THEN billing_private.decimal_text(round((partner/nullif(agrisul,0)-1)*100,6)) END
 ) FROM totals
$$;
REVOKE ALL ON FUNCTION billing_private.cane_summary(jsonb) FROM PUBLIC,anon,authenticated;
