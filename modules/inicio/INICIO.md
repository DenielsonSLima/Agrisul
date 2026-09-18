# Início

O Início reúne a rotina dos módulos existentes em uma consulta de leitura:
`billing_rpc('home', 'get', {companyId, month})`. A RPC deriva a identidade da
sessão e só retorna as seções permitidas para o usuário.

- **Contratos, faturamento e agenda:** empresa ativa. Volume e líquido usam a
  data do carregamento no mês selecionado; caixa usa a data efetiva de
  recebimentos, adiantamentos e estornos. Os valores financeiros reaproveitam
  a apuração dos contratos, com precisão NUMERIC e decimais em texto. Se faltar
  ATR ou cotação, o líquido permanece “A apurar”.
- **Prazos:** contratos ativos com término vencido ou nos próximos 30 dias.
  A agenda mostra hoje e os próximos seis dias, inclusive ao mudar de mês.
- **Solicitações:** espaço de trabalho, independentemente da empresa e do
  mês. A contagem de retornos atrasados usa o último complemento e considera
  somente serviços aprovados ainda não concluídos.
- **Planejamento:** uma safra ativa que abrange hoje, priorizando a que termina
  por último. Plantio e colheita acumulam até hoje; registros anulados não
  entram no plantio. Metas de safras sobrepostas não são somadas.
- **Cadastros:** clientes, prestadores, fazendas e talhões do espaço de trabalho.

Sem empresa, o usuário continua vendo as seções compartilhadas às quais tem
acesso. Permissões, cálculos, seleção das prioridades e limites das listas
ficam no banco. O frontend só formata e apresenta os dados.

O cache usa `['billing', userId, 'home', {companyId, month}]`. Mutations e
Realtime invalidam a projeção; uma consulta a cada minuto atualiza os prazos
mesmo com a página aberta durante a mudança do dia. As datas atuais usam
America/Sao_Paulo. O filtro mensal não altera as pendências atuais.

Validação: `supabase/tests/home_dashboard.sql`, integrado à suíte PGlite;
`tests/data-cache.test.mjs`; e `tests/home-dashboard-live.mjs`, habilitado por
`BILLING_RUN_LIVE_TESTS=1`, com contas temporárias e limpeza no final. O teste
de navegador usa o servidor `npm run dev` em localhost:5173 e Chrome com CDP
em localhost:9241 (ou `BILLING_CDP_URL`).
