DO $migration$
DECLARE
  v_table text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'A publicação esperada supabase_realtime não existe.'
      USING ERRCODE = '55000';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'billing_fleet_vehicles',
    'billing_material_variants'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = v_table
        AND relation.relkind IN ('r', 'p')
    ) THEN
      RAISE EXCEPTION 'A tabela esperada public.% não existe.', v_table
        USING ERRCODE = '42P01';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        v_table
      );
    END IF;
  END LOOP;
END
$migration$;
