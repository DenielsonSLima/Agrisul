-- A stale form is a permanent application conflict (HTTP 409), not a
-- transaction serialization failure eligible for infrastructure retries.
DO $$
DECLARE v_definition text;v_old text;
BEGIN
 SELECT pg_get_functiondef('billing_private.complement_service_request(jsonb)'::regprocedure) INTO v_definition;
 v_old=$old$RAISE EXCEPTION 'Os dados foram complementados por outra pessoa. Feche e abra o formulário para conferir a atualização.' USING ERRCODE='40001';$old$;
 IF strpos(v_definition,v_old)=0 THEN RAISE EXCEPTION 'Verificação de versão inesperada'; END IF;
 EXECUTE replace(v_definition,v_old,replace(v_old,'''40001''','''23505'''));
END $$;
