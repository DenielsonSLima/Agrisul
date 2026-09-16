# Controle de Faturamento

## Escopo e projeto remoto

- Este checkout pertence ao Supabase `rbuscpwntzpyqsuycqmv`. Confirme esse identificador antes de qualquer operação remota.
- O MCP do Antigravity é `supabase-controle-faturamento`. Preserve as outras conexões e projetos. `scripts/supabase-mcp.mjs` lê a credencial fora do repositório e verifica o destino.
- Configurações, Cadastros e seus contratos operacionais usam Supabase. Os repositories D1 e testes antigos documentam a implementação anterior; não reintroduza D1/R2 nessas telas.

## Regras de implementação solicitadas pelo usuário

- Frontend apresenta dados e coleta entradas. Cálculos de negócio, totais, saldos, capacidade de área, unicidade, vínculos e autorizações ficam no Postgres, dentro das RPCs.
- Formatação de números/datas e geometria de prévia são apresentação; não substituem regras de banco.
- Acesso de negócio passa por `public.billing_rpc(p_resource,p_action,p_payload)`. Use o wrapper `shared/supabase/rpc.ts` no frontend. Não grave tabelas diretamente.
- O wrapper público é SECURITY INVOKER. O dispatcher privado usa SECURITY DEFINER, `search_path=''`, whitelist de recursos/campos e `auth.uid()` explícito. Nenhum owner do payload decide acesso.
- Tabelas `billing_*` têm RLS por proprietário. `authenticated` recebe SELECT para Realtime; DML direto é revogado. Preserve chaves estrangeiras compostas por proprietário.
- Use NUMERIC no banco para áreas/valores e retorne decimais como texto. Preserve os bloqueios transacionais que protegem capacidade e empresa principal.
- TanStack Query é a fonte do estado remoto: chaves `['billing', userId, resource, ...params]`, cancelamento e invalidação aguardada nas mutations.
- Realtime é centralizado em `shared/query/DataProvider.tsx`. Atualize o mapa de dependências ao adicionar tabelas. Reconexão deve reconsultar dados; eventos não são uma fonte confiável para preencher diretamente o cache.
- Troca de conta/logout deve cancelar consultas, limpar cache e desmontar os formulários da conta anterior.
- Marca d'água usa bucket privado `billing-watermarks`, caminho por usuário e URL assinada. Chaves administrativas nunca pertencem ao frontend, `.env` público ou bundle.

## Verificação

- Preserve o pnpm-lock.yaml e versões fixadas. Execute `npm run dev` para servir localmente.
- Gere migrations pelo CLI antes de escrever novas alterações SQL; revise o SQL e valide regras/isolamento antes de aplicar ao projeto correto.
- Os testes Supabase ficam em `supabase/tests` e `tests/*rpc*`/`tests/*supabase*`/`tests/data-cache.test.mjs`. Testes D1 antigos não validam os endpoints atuais.
- Verifique TypeScript, testes pertinentes e build após alterações de integração. Testes remotos devem usar identidades efêmeras e remover somente os dados criados por eles.
- Não altere os contratos funcionais ou amplie módulos de administração de usuários sem uma necessidade da tarefa.
