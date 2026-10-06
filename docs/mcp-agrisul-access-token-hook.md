# Modelo local do hook de access token A/B

O modelo `docs/mcp-sql-pending/20261006010720_agrisul_mcp_access_token_hook.sql`
cria `agrisul_mcp_hook_private.access_token(jsonb)` e uma tabela de
configuração **vazia**. Ele não habilita o hook no Supabase Auth, não registra
clientes OAuth, não grava um ID real e não ativa o MCP. A função só lê a
configuração, usa `SECURITY INVOKER` e pode ser executada apenas por
`supabase_auth_admin`. A tabela tem RLS; Auth só recebe `SELECT`, enquanto
`anon` e `authenticated` não recebem acesso ao schema nem à função.
O arquivo fica fora de `supabase/migrations` para não entrar em `db push`
antes da aprovação específica. Se a função for ativada por engano sem uma
configuração habilitada, rejeita tokens que tragam `client_id`; sessões web
sem esse ID permanecem inalteradas. Conferir clientes OAuth já existentes
antes de configurar o hook, pois eles também seriam rejeitados nesse estado.

## Contrato esperado

Na [referência geral do Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook),
`client_id` aparece em `event.claims.client_id`, `authentication_method` no
topo e a saída é `{ "claims": <todas as claims> }`. O [guia de tokens OAuth](https://supabase.com/docs/guides/auth/oauth-server/token-security)
mostra `client_id` no topo e um exemplo com saída parcial, incompatível com
a referência geral. O modelo aceita o ID em qualquer uma dessas posições,
rejeita conflito envolvendo A e sempre devolve as claims completas. Não há
filtro pelo método de autenticação: a mesma regra para A atua em
`oauth_provider/authorization_code` e `token_refresh` quando o evento
contém o ID do cliente.

Somente o cliente A configurado recebe `aud=<URL canônica>/api/mcp` e
`role=agrisul_mcp`. Seu `client_id` também é preservado na claim. O cliente
B, outros clientes e sessões web recebem suas claims sem alteração. Para A,
o hook exige as claims obrigatórias, emissor do projeto Agrisul, `aud` e
`role` originais `authenticated` e `is_anonymous=false`; outra forma falha
com erro, sem emitir um token A parcialmente transformado.

**Bloqueio de ativação:** a documentação não prova que `client_id` esteja no
evento de *refresh* OAuth. Um refresh sem ID é indistinguível do refresh
normal da aplicação web. O modelo preserva esse evento para não quebrar a
aplicação, mas isso poderia emitir um token A com direitos Supabase normais.
Os testes PGlite verificam somente o modelo SQL; não substituem a
observação do evento real em Supabase Auth. A configuração deve permanecer
vazia e nenhum grant A pode ser concedido até essa prova.

## Ordem para uma ativação futura, com aprovação separada

1. Confirmar projeto `rbuscpwntzpyqsuycqmv`, histórico de migrations,
   backup, hook já existente e política de assinatura. A migration do cofre
   `20261006002123_agrisul_mcp_upstream_vault.sql` cria a role
   `agrisul_mcp`; aplicar antes deste modelo. Se já houver Custom Access
   Token Hook, integrar a regra A nele, sem substituí-lo às cegas.
2. Em ambiente de teste aprovado, registrar clientes OAuth distintos A e B
   e verificar os redirects exatos. Definir URL HTTPS canônica do MCP e
   conferir que o servidor usa o mesmo valor em `AGRISUL_MCP_RESOURCE`.
3. Após aprovar a configuração, inserir **um único** registro
   `(singleton=true, enabled=true, oauth_client_id=<ID A>,
   resource=<URL canônica>/api/mcp)` em `agrisul_mcp_hook_private.config`.
   Isso contém identificadores, não segredos. Configurar em Authentication
   > Hooks a função Postgres
   `pg-functions://postgres/agrisul_mcp_hook_private/access_token`.
   O [guia de hooks](https://supabase.com/docs/guides/auth/auth-hooks)
   documenta esse URI e recomenda grants explícitos em vez de
   `SECURITY DEFINER`.
4. Capturar de forma segura o formato real do evento para A e B em
   `authorization_code` e `refresh_token`. Confirmar que A sempre carrega
   `client_id` reconhecível e produz `iss` correto, `aud` da URL exata,
   `role=agrisul_mcp`, `client_id=A` e o mesmo `sub`; B mantém
   `aud=authenticated`, `role=authenticated`, `client_id=B`; sessões web
   e seus refreshes permanecem inalterados. Não registrar dados de token,
   PKCE ou outras credenciais em logs permanentes.
5. Com identidades de teste, provar que o bearer A é recusado por
   `public.billing_rpc`, Data API, Storage e operações de usuário do Auth
   API. A role personalizada e o `aud` diferente **não garantem** sozinhos
   a recusa pelo Auth API. Conferir também acesso B conforme RLS/permissões,
   isolamento por workspace, revogação e rotação do refresh. Se qualquer
   API aceitar A para ação indevida, interromper a ativação e redesenhar a
   autorização; `AGRISUL_MCP_ENABLED=false` não corrige acesso direto às
   APIs Supabase.
6. Só depois publicar e habilitar o MCP, configurar o conector e testar o
   fluxo completo no cliente real.

**Desativação segura:** nunca apenas remover o hook ou mudar
`config.enabled=false` enquanto houver grants/refresh tokens A válidos:
um refresh subsequente poderia voltar a `aud=authenticated` e
`role=authenticated`. Primeiro revogar grants/sessões do cliente A e
confirmar expiração/revogação dos access tokens; então desativar o hook.

Teste local: `node supabase/tests/mcp_access_token_hook.pglite.mjs`.
