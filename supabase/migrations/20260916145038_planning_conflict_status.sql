DO $$
DECLARE
 v_definition text;
 v_updated text;
BEGIN
 v_definition=pg_get_functiondef('billing_private.planning_v2_dispatch(text,jsonb)'::regprocedure);
 v_updated=replace(v_definition,'ERRCODE=''40001''','ERRCODE=''PT409''');
 v_updated=replace(v_updated,'ERRCODE = ''40001''','ERRCODE = ''PT409''');
 IF v_updated<>v_definition THEN
  EXECUTE v_updated;
 ELSIF position('PT409' IN v_definition)=0 THEN
  RAISE EXCEPTION 'Não foi possível atualizar o código de conflito do Planejamento.';
 END IF;
END $$;
