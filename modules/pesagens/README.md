# Pesagem de cana

Abra **Pesagem de Cana** no menu lateral (`/pesagens`). Selecione a empresa ativa e crie um controle escolhendo a data inicial e um parceiro cadastrado em **Cadastros → Clientes**. A safra é opcional; quando vazia, o banco a preenche a partir do ano inicial.

Dentro do controle, adicione viagens com data, hora opcional, caminhão e dois reboques. Todos os pesos são informados em **kg**. No modo **Pesados juntos**, informe o bruto conjunto dos reboques: o banco divide esse bruto igualmente, conservando a tara de cada veículo. No modo **Pesados separados**, informe cada bruto individualmente.

Pesos podem ficar pendentes para preenchimento posterior. O líquido AGRISUL é bruto menos tara; a diferença é líquido do parceiro menos líquido AGRISUL. Os totais AGRISUL somam as viagens com pesagem AGRISUL completa, enquanto os totais do parceiro somam os líquidos já informados. A diferença total permanece pendente até todas as viagens terem os dois lados completos. O percentual usa o líquido AGRISUL como base.

O controle apresenta comparativos por veículo, viagem e dia, filtros por data e pendências, edição e exclusão com confirmação. **Salvar e adicionar outra** mantém frota, placas e taras para o próximo lançamento. A exportação CSV usa decimais no formato brasileiro para abertura no Excel.

Os cálculos, vínculos, permissões e validações são executados na RPC `public.billing_rpc`, recurso `cane-weighings`. A interface usa TanStack Query e o Realtime centralizado para reconsultar as projeções. As tabelas novas são `billing_cane_weighing_controls`, `billing_cane_weighing_entries` e `billing_cane_weighing_components`.

## Verificação

`npm test` inclui os testes de RPC com a cadeia real de migrations em PGlite e os testes de precisão/exportação. A fixture de 18/10 valida as 15 viagens reais e impede a repetição do subtotal perdido no Excel. Consulte [REFERENCIA-PLANILHA.md](./REFERENCIA-PLANILHA.md) para os exemplos e as decisões da reunião dos três agentes.

O teste remoto é optativo: `tests/cane-weighings-supabase-live.mjs`. Ele exige `BILLING_RUN_LIVE_TESTS=1`, CLI autenticado e vínculo com `ykounjabfsrtkzostbbz`. `BILLING_SUPABASE_CLI` pode indicar o executável. Com `BILLING_CDP_URL` e servidor local iniciado por `npm run dev`, também verifica o fluxo no Chrome. Cria contas efêmeras, mantém as credenciais administrativas apenas em memória e remove somente os dados criados pelo próprio teste.
