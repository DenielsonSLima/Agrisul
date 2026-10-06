-- Apply only after the separate MCP OAuth client and restricted database login
-- have been approved. No login, password, OAuth grant, or live access is made here.
CREATE SCHEMA agrisul_mcp_private;
REVOKE ALL ON SCHEMA agrisul_mcp_private FROM PUBLIC, anon, authenticated;

-- Fail on any name collision. A pre-existing LOGIN or privileged role must
-- never silently acquire these grants.
CREATE ROLE agrisul_mcp NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE agrisul_mcp_vault NOLOGIN NOINHERIT NOBYPASSRLS;

-- A vault connection must prove which project schema it reached before any
-- refresh token is read or written. This row is intentionally immutable to
-- the runtime vault role.
CREATE TABLE agrisul_mcp_private.project_binding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  project_ref text NOT NULL CHECK (project_ref = 'rbuscpwntzpyqsuycqmv')
);
INSERT INTO agrisul_mcp_private.project_binding (singleton, project_ref)
VALUES (true, 'rbuscpwntzpyqsuycqmv');
REVOKE ALL ON agrisul_mcp_private.project_binding FROM PUBLIC, anon, authenticated;
ALTER TABLE agrisul_mcp_private.project_binding ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_binding_vault_read ON agrisul_mcp_private.project_binding
  FOR SELECT TO agrisul_mcp_vault USING (true);

CREATE TABLE agrisul_mcp_private.auth_requests (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  purpose text NOT NULL CHECK (purpose IN ('ticket', 'state')),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verifier_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT auth_requests_verifier_check CHECK (
    (purpose = 'ticket' AND verifier_ciphertext IS NULL) OR
    (purpose = 'state' AND verifier_ciphertext IS NOT NULL)
  ),
  CONSTRAINT auth_requests_expiry_check CHECK (expires_at > created_at)
);
REVOKE ALL ON agrisul_mcp_private.auth_requests FROM PUBLIC, anon, authenticated;
CREATE INDEX auth_requests_expiry_idx ON agrisul_mcp_private.auth_requests (expires_at);
ALTER TABLE agrisul_mcp_private.auth_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_requests_vault_only ON agrisul_mcp_private.auth_requests
  FOR ALL TO agrisul_mcp_vault USING (true) WITH CHECK (true);

CREATE TABLE agrisul_mcp_private.upstream_grants (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_ciphertext text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT upstream_grants_expiry_check CHECK (expires_at > granted_at)
);
REVOKE ALL ON agrisul_mcp_private.upstream_grants FROM PUBLIC, anon, authenticated;
CREATE INDEX upstream_grants_expiry_idx ON agrisul_mcp_private.upstream_grants (expires_at);
ALTER TABLE agrisul_mcp_private.upstream_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY upstream_grants_vault_only ON agrisul_mcp_private.upstream_grants
  FOR ALL TO agrisul_mcp_vault USING (true) WITH CHECK (true);

-- Private schema, no Data API grants. A future dedicated LOGIN may inherit
-- only this NOLOGIN role; it must not be postgres, service_role or a pooler
-- credential with unrelated table privileges.
GRANT USAGE ON SCHEMA agrisul_mcp_private TO agrisul_mcp_vault;
GRANT SELECT ON agrisul_mcp_private.project_binding TO agrisul_mcp_vault;
GRANT SELECT, INSERT, UPDATE, DELETE ON agrisul_mcp_private.auth_requests TO agrisul_mcp_vault;
GRANT SELECT, INSERT, UPDATE, DELETE ON agrisul_mcp_private.upstream_grants TO agrisul_mcp_vault;
