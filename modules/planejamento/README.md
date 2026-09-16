# Planejamento

O Planejamento separa a situação física atual da intenção futura. Cada talhão possui área total e área já plantada; cada safra informa nome livre, data inicial, data final, cultura, ciclo e meta de novo plantio. Assim, uma fazenda de 100 ha pode ter 20 ha plantados e uma meta de acrescentar outros 20 ha no período escolhido.

A primeira tela lista as safras em tabela. Ao abrir uma delas, o usuário encontra **Resumo**, **Metas**, **Áreas e talhões**, **Diário de campo** e **Histórico**, além de voltar à lista ou trocar de safra. As fazendas ficam em uma tabela recolhível e exibem seus talhões, a área atual, a meta distribuída, o realizado e o saldo. É possível associar operações cadastradas em Manejo, remanejar saldo e cancelar uma distribuição com motivo.

O Diário registra plantio, manejo e perda/morte por data, fazenda, talhão e hectares. O plantio realizado reduz o saldo da distribuição e aumenta a área plantada física; por isso, 20 ha atuais mais 20 ha realizados aparecem como 40 ha ao criar e abrir a safra seguinte. A próxima safra não é criada automaticamente, pois suas datas e metas exigem decisão do usuário. Uma perda reduz imediatamente a área plantada e sua anulação restaura o saldo. Os lançamentos permanecem auditáveis.

A meta de colheita é informada em toneladas e recebe um conjunto explícito de talhões. O realizado não é digitado no Planejamento: é calculado a partir dos carregamentos dos contratos cujos talhões e datas pertencem à safra. O Resumo e o Diário agregam plantio, manejo, perdas e colheita por dia, mês e total do período.

O período não depende de rótulos fixos como “verão”, “inverno” ou “2026/2027”: o usuário escolhe qualquer intervalo de datas e pode dar o nome que preferir. Planos sobrepostos compartilham a capacidade do talhão. O Postgres bloqueia qualquer combinação em que área plantada mais os saldos simultâneos ainda não executados ultrapasse a área física, e também impede distribuir acima da meta da safra.

Todos os cálculos e bloqueios usam `public.billing_rpc('planning', ...)`. O frontend apenas coleta e apresenta dados. Gravações diretas nas tabelas `billing_planning_*` são revogadas, há RLS por proprietário, revisão otimista para edições concorrentes e histórico imutável das alterações. As consultas usam TanStack Query e as tabelas participam do Realtime centralizado.

Validação local: `npm test`, `node node_modules/typescript/bin/tsc --noEmit` e `npm run build`. O teste remoto isolado `tests/planning-supabase-live.test.mjs` exige `BILLING_RUN_LIVE_TESTS=1`, confirma o projeto `rbuscpwntzpyqsuycqmv`, cria duas contas temporárias e remove somente essas contas ao finalizar.
