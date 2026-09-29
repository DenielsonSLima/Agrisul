-- Administrative, one-time workspace snapshot cloning. This function is kept
-- private and has no grant to application roles. It clones registrations,
-- contracts, finance and planning with fresh identifiers. Transactional
-- quotation, purchase-order and service-request evidence is deliberately not
-- part of the manifest.

CREATE FUNCTION billing_private.clone_workspace_snapshot(
  p_source_owner uuid,
  p_target_owner uuid,
  p_target_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_table text;
  v_column text;
  v_columns text;
  v_selects text;
  v_expression text;
  v_reference_schema text;
  v_reference_table text;
  v_reference_column text;
  v_is_text boolean;
  v_has_id boolean;
  v_exists boolean;
  v_count bigint;
  v_counts jsonb:='{}'::jsonb;
  v_name text:=left(coalesce(nullif(btrim(p_target_name),''),'Nova conta'),150);
  v_tables text[]:=ARRAY[
    'billing_profiles',
    'billing_companies',
    'billing_clients',
    'billing_atr_records',
    'billing_farms',
    'billing_contract_types',
    'billing_cultures',
    'billing_material_categories',
    'billing_fleet_vehicles',
    'billing_service_providers',
    'billing_payment_methods',
    'billing_document_templates',
    'billing_watermarks',
    'billing_planning_goals',
    'billing_culture_subtypes',
    'billing_farm_plots',
    'billing_materials',
    'billing_service_provider_contacts',
    'billing_cultural_practices',
    'billing_material_variants',
    'billing_contracts',
    'billing_planning_periods',
    'billing_planning_entries',
    'billing_contract_loads',
    'billing_contract_payments',
    'billing_contract_discounts',
    'billing_planning_allocations',
    'billing_planning_executions',
    'billing_planning_goal_entries',
    'billing_planning_goal_revisions',
    'billing_planning_allocation_practices',
    'billing_planning_harvest_plots',
    'billing_planning_harvest_targets',
    'billing_planning_history',
    'billing_planning_field_logs',
    'billing_report_headers'
  ];
BEGIN
  IF p_source_owner IS NULL OR p_target_owner IS NULL OR p_source_owner=p_target_owner THEN
    RAISE EXCEPTION 'Informe espaços de origem e destino diferentes.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.billing_memberships
    WHERE owner_id=p_source_owner AND user_id=p_source_owner AND is_owner AND status='active'
  ) THEN
    RAISE EXCEPTION 'O espaço de origem não possui um proprietário ativo.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_target_owner) THEN
    RAISE EXCEPTION 'Crie a conta de destino no Supabase Auth antes da clonagem.' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('billing-clone:'||p_target_owner::text,0));
  IF EXISTS(SELECT 1 FROM public.billing_memberships WHERE user_id=p_target_owner) THEN
    RAISE EXCEPTION 'A conta de destino já pertence a um espaço de trabalho.' USING ERRCODE='23505';
  END IF;

  CREATE TEMP TABLE pg_temp.billing_clone_ids(
    entity text NOT NULL,
    old_id uuid NOT NULL,
    new_id uuid NOT NULL,
    PRIMARY KEY(entity,old_id),
    UNIQUE(entity,new_id)
  ) ON COMMIT DROP;

  -- Default access profiles belong to the new workspace; members and invites
  -- from the source are intentionally never copied.
  PERFORM billing_private.create_workspace_defaults(p_target_owner);
  INSERT INTO public.billing_memberships(owner_id,user_id,access_profile_id,is_owner,status)
  VALUES(p_target_owner,p_target_owner,NULL,true,'active');
  INSERT INTO public.billing_user_settings(user_id,owner_id,name,compact,onboarding_completed_at)
  VALUES(p_target_owner,p_target_owner,v_name,false,clock_timestamp());

  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.'||v_table) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE owner_id=$1)',v_table)
      INTO v_exists USING p_target_owner;
    IF v_exists THEN
      RAISE EXCEPTION 'O destino já possui dados em %. A clonagem foi cancelada.',v_table USING ERRCODE='23505';
    END IF;

    SELECT EXISTS(
      SELECT 1
      FROM pg_catalog.pg_attribute attribute
      WHERE attribute.attrelid=to_regclass('public.'||v_table)
        AND attribute.attname='id' AND attribute.atttypid='uuid'::regtype
        AND attribute.attnum>0 AND NOT attribute.attisdropped
    ) INTO v_has_id;

    IF v_has_id THEN
      EXECUTE format(
        'INSERT INTO pg_temp.billing_clone_ids(entity,old_id,new_id) '
        'SELECT %L,id,gen_random_uuid() FROM public.%I WHERE owner_id=$1',
        v_table,v_table
      ) USING p_source_owner;
    END IF;

    v_columns:='';
    v_selects:='';
    FOR v_column,v_is_text IN
      SELECT attribute.attname,
             attribute.atttypid IN ('text'::regtype,'varchar'::regtype,'bpchar'::regtype)
      FROM pg_catalog.pg_attribute attribute
      WHERE attribute.attrelid=to_regclass('public.'||v_table)
        AND attribute.attnum>0 AND NOT attribute.attisdropped
        AND attribute.attgenerated=''
      ORDER BY attribute.attnum
    LOOP
      v_reference_schema:=NULL;
      v_reference_table:=NULL;
      v_reference_column:=NULL;

      IF v_column='owner_id' THEN
        v_expression:='$2::uuid';
      ELSIF v_column='id' AND v_has_id THEN
        v_expression:=format(
          '(SELECT mapped.new_id FROM pg_temp.billing_clone_ids mapped '
          'WHERE mapped.entity=%L AND mapped.old_id=source_row.id)',v_table
        );
      ELSE
        SELECT referenced_namespace.nspname,referenced_table.relname,referenced_attribute.attname
          INTO v_reference_schema,v_reference_table,v_reference_column
        FROM pg_catalog.pg_constraint relation
        JOIN LATERAL unnest(relation.conkey) WITH ORDINALITY source_key(attnum,position) ON true
        JOIN LATERAL unnest(relation.confkey) WITH ORDINALITY referenced_key(attnum,position)
          ON referenced_key.position=source_key.position
        JOIN pg_catalog.pg_attribute source_attribute
          ON source_attribute.attrelid=relation.conrelid AND source_attribute.attnum=source_key.attnum
        JOIN pg_catalog.pg_attribute referenced_attribute
          ON referenced_attribute.attrelid=relation.confrelid AND referenced_attribute.attnum=referenced_key.attnum
        JOIN pg_catalog.pg_class referenced_table ON referenced_table.oid=relation.confrelid
        JOIN pg_catalog.pg_namespace referenced_namespace ON referenced_namespace.oid=referenced_table.relnamespace
        WHERE relation.contype='f'
          AND relation.conrelid=to_regclass('public.'||v_table)
          AND source_attribute.attname=v_column
          AND referenced_attribute.attname='id'
        ORDER BY CASE WHEN referenced_namespace.nspname='public' THEN 0 ELSE 1 END
        LIMIT 1;

        IF v_reference_schema='public' AND v_reference_table=ANY(v_tables) THEN
          v_expression:=format(
            '(SELECT mapped.new_id FROM pg_temp.billing_clone_ids mapped '
            'WHERE mapped.entity=%L AND mapped.old_id=source_row.%I)',
            v_reference_table,v_column
          );
        ELSIF v_reference_schema='auth' AND v_reference_table='users' THEN
          v_expression:=format('CASE WHEN source_row.%1$I IS NULL THEN NULL ELSE $2::uuid END',v_column);
        ELSIF v_column=ANY(ARRAY[
          'created_by','updated_by','voided_by','actor_id','recorded_by','decided_by'
        ]) THEN
          v_expression:=format('CASE WHEN source_row.%1$I IS NULL THEN NULL ELSE $2::uuid END',v_column);
        ELSIF v_is_text AND v_column ~ '(^|_)(key|path)$' THEN
          v_expression:=format(
            'CASE WHEN source_row.%1$I LIKE $1::text||''/%%'' '
            'THEN $2::text||substr(source_row.%1$I,length($1::text)+1) ELSE source_row.%1$I END',
            v_column
          );
        ELSE
          v_expression:=format('source_row.%I',v_column);
        END IF;
      END IF;

      v_columns:=v_columns||CASE WHEN v_columns='' THEN '' ELSE ',' END||format('%I',v_column);
      v_selects:=v_selects||CASE WHEN v_selects='' THEN '' ELSE ',' END||v_expression;
    END LOOP;

    EXECUTE format(
      'INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM public.%1$I source_row WHERE source_row.owner_id=$1',
      v_table,v_columns,v_selects
    ) USING p_source_owner,p_target_owner;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    v_counts:=v_counts||jsonb_build_object(v_table,v_count);
  END LOOP;

  -- The account is provisioned with a temporary password by the Auth Admin
  -- client. Business RPCs remain blocked until that exact hash changes.
  PERFORM billing_private.require_temporary_password_change(p_target_owner);

  RETURN jsonb_build_object(
    'sourceOwner',p_source_owner,
    'targetOwner',p_target_owner,
    'counts',v_counts,
    'excluded',jsonb_build_array('quotations','purchase-orders','service-requests')
  );
END $$;

REVOKE ALL ON FUNCTION billing_private.clone_workspace_snapshot(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION billing_private.clone_workspace_snapshot(uuid,uuid,text) IS
  'Administrative snapshot clone with fresh row IDs. No application role can execute it.';
