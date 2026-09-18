# Financeiro do contrato

- `contracts/get` retorna `contract.financialSummary`, com indicadores por mês, totais do contrato, recebimentos e acordos de desconto.
- O carregamento registra a quantidade líquida em toneladas e seu ATR medido em kg/t, além da data e origem. A cotação em R$/kg ATR vem do cadastro do mês anterior à data do carregamento (`loadedAt`), conforme bruto/líquido e mensal/acumulado do contrato. Janeiro usa dezembro do ano anterior; todos os dias do mês usam a mesma referência de cotação.
- O valor entregue é quantidade (t) × ATR do carregamento (kg/t) × cotação selecionada (R$/kg), calculado no Postgres. O ATR médio é ponderado pelo volume. Alterações na data, no ATR medido, no critério do contrato ou na cotação recalculam os resultados nas consultas.
- `load.atr` retorna o ATR medido; `averageAtr` e `averageLoadAtr` retornam suas médias ponderadas. `atrReferenceMonth` identifica o mês da cotação. `save-load` exige ATR positivo com até seis casas decimais. Carregamentos antigos sem ATR ficam pendentes até que sejam editados e tenham sua medição informada.
- O valor financeiro geral soma os valores mensais arredondados em centavos. Cada desconto é arredondado por acordo e mês antes da soma.
- A lista e a exportação de carregamentos mostram faturamento, desconto e valor líquido por carga, retornados por `contracts/list` com `view: loads`. O líquido desconta os acordos aplicáveis, sem abater recebimentos ou adiantamentos. Sem ATR ou cotação, faturamento e líquido exibem “Pendente”, preservando o desconto.
- Os centavos por carga são distribuídos pela diferença entre os arredondamentos acumulados do mês, em ordem de data, criação e identificador. Descontos são distribuídos separadamente por acordo. O banco calcula sobre todas as cargas do contrato antes dos filtros; assim, busca, período e agrupamento mantêm os mesmos valores e a soma mensal coincide com o Financeiro.
- Os KPIs de faturamento, descontos e líquido de Carregamentos somam no banco os valores das cargas que atendem à busca e ao período selecionados. Se uma carga filtrada estiver pendente, faturamento e líquido ficam pendentes, preservando os descontos conhecidos. Sem resultados, os três indicadores retornam zero.
- `advance` registra adiantamentos; `receipt` registra os demais recebimentos. Ambos abatem o saldo. Não relançar um adiantamento como recebimento.
- A data do recebimento registra quando o dinheiro entrou. O mês de referência determina em qual mês do contrato ele abate o saldo. Não há compensação automática de um excedente entre meses; o saldo geral considera todas as entradas.
- Total = valor entregue − descontos. Recebido líquido = adiantamentos + recebimentos − estornos. Pendente = máximo entre total − recebido líquido e zero. O excedente recebido e o valor ainda estornável aparecem separados.
- `close` encerra somente contratos ativos e com ATR/cotações totalmente apurados. A conclusão é uma operação explícita, confirmada na interface; carregamentos e descontos ficam congelados depois dela.
- `save-refund` e `delete-refund` registram a devolução do adiantamento excedente apenas em contrato concluído. O banco limita o acumulado ao menor valor entre o adiantamento ainda não devolvido e o crédito financeiro efetivo. Alterações concorrentes em pagamentos não podem invalidar um estorno já registrado.
- Um acordo define nome, R$/t e meses explícitos. A taxa incide sobre todas as toneladas entregues nesses meses, acompanhando inclusões, alterações e exclusões de carregamentos. Acordos diferentes no mesmo mês são somados. Para taxas diferentes, cadastrar acordos separados.
- Sem ATR medido ou cotação para uma entrega, o valor entregue, o total e o saldo do mês e do contrato ficam pendentes de cálculo. Quantidades, descontos e pagamentos continuam visíveis.

## Painel visual

A aba Resumo e sua exportação apresentam os descontos, o líquido, os recebidos (incluindo adiantamentos) e o pendente de `financialSummary`, por mês de referência e no total do contrato. A apresentação associa esses valores às entregas de `monthlySummary` e inclui meses com pagamentos sem carregamento. Meses vazios de acordos futuros não geram linhas no Resumo. Valores dependentes de ATR pendente permanecem em aberto, preservando descontos e recebidos.

A lista de Contratos recebe `summary` e `financialTotals` de `contracts/list`. Os sete indicadores acompanham a empresa ativa, a aba (Em aberto = Ativo; Finalizado = Concluído ou Cancelado), a busca e as datas do contrato. As datas selecionam contratos; os indicadores incluem todos os lançamentos desses contratos. A média de ATR é ponderada pelo volume no banco. Os pendentes somam o saldo de cada contrato, sem compensar créditos de outro contrato. A falta de ATR ou cotação mantém bruto, líquido e saldo aguardando cálculo, preservando volume, descontos e recebidos.

O relatório da lista usa A4 em paisagem, com o cabeçalho e a marca d’água dessa orientação, sem alterar a preferência global de outros relatórios. Além do ATR medido médio em kg/t, mostra a cotação média em R$/kg ATR de `atrQuoteSummary`, devolvida por contrato pela RPC. Essa média pondera as cotações pelas toneladas, usa o critério bruto/líquido e mensal/acumulado do contrato e considera somente os meses com carregamento, sempre com a cotação do mês anterior. Janeiro referencia dezembro do ano anterior. Cotações ausentes mantêm a média pendente; contratos sem carregamentos não recebem média fictícia. A coluna Despesas apresenta os descontos/acordos de `financialTotals.discountAmount`, e o faturamento líquido apresenta `financialTotals.netAmount`. Prévia, download e impressão compartilham os mesmos valores e filtros.

O relatório agrupa cada contrato em duas linhas, mantidas juntas na paginação: identificação, quantidades contratada/carregada/pendente e ATR na primeira; bruto, despesas, líquido, recebidos, adiantamentos, saldo a receber e excedente recebido na segunda. Cliente e CNPJ identificam o grupo, com número do contrato em coluna própria. Os recebidos já incluem os adiantamentos; o excedente não é um novo recebimento. Todos os valores usam os campos da RPC, sem refazer os cálculos na apresentação. Indicadores e células financeiras compartilham cores entre prévia e PDF, com bordas entre colunas e separadores entre contratos.

O gráfico de evolução alterna entre valores financeiros (entregue, após descontos e recebido) e produção (toneladas e ATR médio, em eixos separados). O filtro de ano altera somente o período exibido. Selecionar um mês pelo gráfico atualiza os indicadores e lançamentos desse mês.

A composição dos recebimentos separa adiantamentos, recebimentos e estornos, com opção de consultar o mês ou todo o contrato. Os gráficos usam os valores retornados pela RPC; meses com faturamento pendente não são convertidos em zero. O histórico mensal mantém os valores exatos para conferência.

## Persistência e atualização

Todas as operações passam por `billing_rpc`, recurso `contracts`: `close`, `save-payment`, `delete-payment`, `save-refund`, `delete-refund`, `save-discount` e `delete-discount`. O banco verifica usuário, permissão, proprietário e empresa. Valores decimais são texto na API e `NUMERIC` no Postgres.

Novos lançamentos usam `requestId` para impedir duplicação em reenvios simultâneos. Alterações e exclusões exigem `expectedRevision`. O bloqueio do contrato serializa gravações concorrentes. As duas tabelas têm RLS, SELECT para Realtime e DML direto revogado.

O cache `['billing', userId, 'contracts', ...]` é cancelado antes das mutations e invalidado com espera após a gravação. Eventos Realtime de pagamentos, descontos, carregamentos e cotações atualizam os indicadores por nova consulta.

## Verificação

- `npm test`: inclui `supabase/tests/contract_finance.sql` e `supabase/tests/contract_closure_refunds.sql`, executados em Postgres local via PGlite.
- `tests/contract-finance-supabase-live.test.mjs`: requer `BILLING_RUN_LIVE_TESTS=1` e a configuração MCP do projeto `rbuscpwntzpyqsuycqmv`; usa e remove duas contas temporárias.
- Com `BILLING_BROWSER_CDP`, a mesma verificação testa os formulários no servidor local e salva capturas em `.sites-runtime/finance`.
