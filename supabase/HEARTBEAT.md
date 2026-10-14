# Verificação periódica do banco

O workflow `.github/workflows/supabase-heartbeat.yml` consulta o Postgres do projeto
`rbuscpwntzpyqsuycqmv` a cada 6 horas, às 00:23, 06:23, 12:23 e 18:23 UTC.
Ele funciona no GitHub, mesmo com o computador desligado. Também executa ao
publicar alterações no próprio workflow e permite execução manual em Actions.

A RPC `public.billing_healthcheck()` usa `SECURITY INVOKER` e retorna somente
disponibilidade, identificador do projeto e horário do banco. Não consulta dados
de contas nem modifica registros. A chave usada pelo workflow é pública e
publicável; nenhuma credencial administrativa é enviada ao GitHub.

O Supabase considera a atividade do banco nos últimos sete dias. Algumas
requisições por dia normalmente bastam para reduzir pausas por inatividade,
mas somente planos pagos oferecem garantia contra essa pausa:
https://supabase.com/docs/guides/platform/free-project-pausing

O GitHub pode atrasar uma execução agendada e desativa agendas de repositórios
públicos após 60 dias sem atividade no repositório. Nesse caso, reative o
workflow em Actions. A verificação também sinaliza falhas do banco nos logs
das execuções; não reativa automaticamente projetos que já estejam pausados:
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

Se a chave pública for revogada, substitua `SUPABASE_PUBLISHABLE_KEY` no
workflow por outra chave **publishable** do mesmo projeto. Nunca use uma
chave secret, service_role ou token da Management API nesse arquivo.
