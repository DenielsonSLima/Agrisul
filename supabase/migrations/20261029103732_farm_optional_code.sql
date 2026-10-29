-- Optional external identifier: text preserves leading zeroes and letters.
ALTER TABLE public.billing_farms
 ADD COLUMN code text NOT NULL DEFAULT ''
 CONSTRAINT billing_farms_code_length CHECK (length(code)<=50);

-- Extend the existing farm field allowlist while retaining its owner checks,
-- advisory/row locks, capacity rules and all other resource routes.
DO $migration$
DECLARE
 definition text:=pg_get_functiondef('billing_private.dispatch_before_fleet(text,text,jsonb)'::regprocedure);
 anchor text:=$anchor$v_data=v_data||jsonb_build_object('city',btrim(p_payload->>'city'),'state',upper(btrim(p_payload->>'state')));$anchor$;
 replacement text:=$replacement$v_data=v_data||jsonb_build_object('city',btrim(p_payload->>'city'),'state',upper(btrim(p_payload->>'state')));
     IF p_payload ? 'code' AND jsonb_typeof(p_payload->'code') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Informe o código da fazenda como texto.' USING ERRCODE='22023';
     END IF;
     v_text=CASE WHEN p_payload ? 'code' THEN btrim(p_payload->>'code') ELSE coalesce(v_existing->>'code','') END;
     IF length(v_text)>50 THEN
      RAISE EXCEPTION 'O código da fazenda deve ter até 50 caracteres.' USING ERRCODE='22023';
     END IF;
     v_data=v_data||jsonb_build_object('code',v_text);$replacement$;
BEGIN
 IF strpos(definition,anchor)=0 THEN
  RAISE EXCEPTION 'Farm save dispatcher anchor missing';
 END IF;
 EXECUTE replace(definition,anchor,replacement);
END $migration$;
