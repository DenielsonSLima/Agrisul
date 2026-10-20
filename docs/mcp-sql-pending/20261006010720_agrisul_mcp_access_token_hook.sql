-- Local model only. Applying this migration does not enable the Auth hook or
-- configure an OAuth client. The config table deliberately starts empty.
-- The hook must not be enabled until the A/B authorization-code AND refresh
-- event shapes and direct Supabase API denial have been verified in a real
-- test environment. See docs/mcp-agrisul-access-token-hook.md.
BEGIN;

CREATE SCHEMA agrisul_mcp_hook_private;
REVOKE ALL ON SCHEMA agrisul_mcp_hook_private FROM PUBLIC, anon, authenticated;

-- This row contains identifiers, never credentials. Only a project
-- administrator can add/enable it after separately approved OAuth setup.
CREATE TABLE agrisul_mcp_hook_private.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  oauth_client_id text NOT NULL CHECK (length(oauth_client_id) BETWEEN 1 AND 200),
  resource text NOT NULL CHECK (
    length(resource) BETWEEN 20 AND 2048 AND
    resource ~ '^https://[A-Za-z0-9.-]+/api/mcp$'
  )
);
REVOKE ALL ON agrisul_mcp_hook_private.config FROM PUBLIC, anon, authenticated;
ALTER TABLE agrisul_mcp_hook_private.config ENABLE ROW LEVEL SECURITY;
CREATE POLICY agrisul_mcp_hook_auth_read ON agrisul_mcp_hook_private.config
  FOR SELECT TO supabase_auth_admin USING (true);

-- Supabase's generic hook contract puts client_id inside claims and requires
-- returning the complete claims object. Its OAuth guide instead shows a
-- top-level client_id. Accept either documented shape for A, but reject a
-- disagreement. Unrecognized clients and normal web sessions are unchanged.
CREATE FUNCTION agrisul_mcp_hook_private.access_token(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_claims jsonb;
  v_client_in_claims text;
  v_client_at_top text;
  v_client_id text;
  v_config agrisul_mcp_hook_private.config%ROWTYPE;
  v_required text;
BEGIN
  IF jsonb_typeof(event) IS DISTINCT FROM 'object' OR
     jsonb_typeof(event->'claims') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid access token hook event.' USING ERRCODE = '22023';
  END IF;
  v_claims := event->'claims';
  SELECT * INTO v_config FROM agrisul_mcp_hook_private.config WHERE singleton = true;
  IF NOT FOUND OR NOT v_config.enabled THEN
    -- If this function is mistakenly activated while unconfigured, fail
    -- closed for OAuth clients. Web sessions without client_id are preserved.
    IF event ? 'client_id' OR v_claims ? 'client_id' THEN
      RAISE EXCEPTION 'OAuth access token hook is not configured.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('claims', v_claims);
  END IF;

  v_client_in_claims := nullif(v_claims->>'client_id', '');
  v_client_at_top := nullif(event->>'client_id', '');
  IF (v_client_in_claims = v_config.oauth_client_id OR
      v_client_at_top = v_config.oauth_client_id) AND
     v_client_in_claims IS NOT NULL AND v_client_at_top IS NOT NULL AND
     v_client_in_claims <> v_client_at_top THEN
    RAISE EXCEPTION 'Conflicting OAuth client IDs in hook event.' USING ERRCODE = '22023';
  END IF;
  v_client_id := coalesce(v_client_in_claims, v_client_at_top);
  IF v_client_id IS DISTINCT FROM v_config.oauth_client_id THEN
    RETURN jsonb_build_object('claims', v_claims);
  END IF;

  IF (v_client_in_claims IS NOT NULL AND
      jsonb_typeof(v_claims->'client_id') IS DISTINCT FROM 'string') OR
     (v_client_at_top IS NOT NULL AND
      jsonb_typeof(event->'client_id') IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'Invalid MCP OAuth client ID.' USING ERRCODE = '22023';
  END IF;
  FOREACH v_required IN ARRAY ARRAY[
    'iss', 'aud', 'exp', 'iat', 'sub', 'role', 'aal', 'session_id',
    'email', 'phone', 'is_anonymous'
  ] LOOP
    IF NOT jsonb_exists(v_claims, v_required) THEN
      RAISE EXCEPTION 'Missing required claim in MCP token.' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF v_claims->>'iss' IS DISTINCT FROM
       'https://rbuscpwntzpyqsuycqmv.supabase.co/auth/v1' OR
     v_claims->>'aud' IS DISTINCT FROM 'authenticated' OR
     v_claims->>'role' IS DISTINCT FROM 'authenticated' OR
     v_claims->'is_anonymous' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'Unexpected original MCP token claims.' USING ERRCODE = '22023';
  END IF;

  -- No authentication-method filter: the same A-only transformation applies
  -- to authorization_code and token_refresh when the event carries client_id.
  -- A missing client_id on refresh cannot be distinguished from a web refresh;
  -- real provider behavior is therefore an activation gate, not an assumption.
  v_claims := jsonb_set(v_claims, '{client_id}', to_jsonb(v_config.oauth_client_id), true);
  v_claims := jsonb_set(v_claims, '{aud}', to_jsonb(v_config.resource), false);
  v_claims := jsonb_set(v_claims, '{role}', to_jsonb('agrisul_mcp'::text), false);
  RETURN jsonb_build_object('claims', v_claims);
END;
$$;

-- Keep the function inaccessible through Data API and directly executable
-- only by Supabase Auth. SECURITY INVOKER avoids postgres-owner privileges.
REVOKE ALL ON FUNCTION agrisul_mcp_hook_private.access_token(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA agrisul_mcp_hook_private TO supabase_auth_admin;
GRANT SELECT ON agrisul_mcp_hook_private.config TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION agrisul_mcp_hook_private.access_token(jsonb)
  TO supabase_auth_admin;

COMMENT ON FUNCTION agrisul_mcp_hook_private.access_token(jsonb) IS
  'Dormant A-only OAuth access token transform; requires separate live validation before Auth hook activation.';
COMMIT;
