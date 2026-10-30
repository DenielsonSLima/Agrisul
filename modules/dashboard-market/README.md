# Referências de mercado

A barra usa publicações externas e preserva a praça, a unidade e a data de cada fonte:

- Dólar e euro: AwesomeAPI pública, com cache de um minuto; Frankfurter é a alternativa diária quando a consulta intradiária falha.
- Soja, milho, boi, trigo, arroz, feijão, suíno e frango: planilha de preços diários da Epagri/Cepa. As praças selecionadas ficam em Santa Catarina e constam no catálogo.
- Cana: projeção da cana básica no campo publicada pelo Consecana-PR/Sistema FAEP.

O movimento visual da barra não altera a frequência das publicações. As fontes e os horários podem ser consultados no painel de informações; valores e percentuais ausentes não são estimados.

## Consultas e cache

O frontend lê `billing_rpc('dashboard-market','get',{group})` pelo wrapper compartilhado, com grupos `currency`, `agriculture` e `cane` independentes. A consulta lê somente o cache no Postgres; abrir a página não inicia downloads nas fontes. A rota `/api/dashboard-market` permanece como adaptação autenticada da mesma RPC para consumidores anteriores.

TanStack Query mantém chaves `['billing', userId, 'dashboard-market', {group}]`. O navegador relê câmbio a cada 60 segundos e os demais grupos a cada 600 segundos enquanto a tela está ativa, também ao reconectar ou retomar o foco. A limpeza do cache e o cancelamento na troca de conta permanecem centralizados no `DataProvider`.

O Supabase Cron chama a Edge Function `dashboard-market-refresh` por grupo: câmbio a cada minuto; agricultura e cana a cada dez minutos. Isso funciona mesmo sem visitantes. As tabelas `billing_private.market_quotes` e `billing_private.market_refresh_state` guardam as últimas publicações, horários de consulta, falhas e leases. São referências públicas compartilhadas, sem registros financeiros ou identificadores de clientes; ficam no schema não exposto, com RLS e sem acesso direto dos clientes. A RPC exige sessão e rejeita campos de proprietário. Não há assinatura Realtime dessas tabelas privadas: a releitura usa as consultas periódicas já existentes.

Somente a função coletora, com credencial de servidor, pode executar `refresh_dashboard_market`. O Cron usa um token exclusivo guardado no Vault e nos segredos da função; ele nunca entra no frontend ou nas migrations. Uma lease por grupo impede coleta concorrente e rejeita resultados de workers antigos. Falha, resposta parcial ou publicação anterior preserva cada último preço válido e marca-o como desatualizado. Preços e percentuais usam NUMERIC e são devolvidos como texto.

`billing_private.market_quote_history` mantém sete dias corridos de coletas válidas, com preço, fonte, URL, publicação e horário observado quando disponível. Coletas sem sucesso não geram preços históricos. O histórico começa com as referências já verificadas no cache e cresce automaticamente; dias sem coleta não são preenchidos. A retenção usa o horário da coleta, sem alterar datas antigas publicadas pelas fontes, e é executada em cada coleta válida e pelo Cron horário `billing-quote-history-retention`. RLS e a revogação de acesso direto também protegem essa tabela; não contém dados de contas/empresas.

A planilha agrícola fornece as duas publicações válidas mais recentes do mesmo produto e praça, independentemente da ordem das linhas. A alternativa diária do câmbio consulta até 14 dias de publicações para encontrar a data anterior, cobrindo fins de semana/feriados; falha no histórico preserva o preço atual. O Postgres compara registros da mesma fonte e calcula `(atual − anterior) / anterior × 100`, com seis casas. Percentuais explícitos da fonte mantêm sua precisão e a identificação `source`; os calculados no banco recebem `previous-publication`, com valor, data e URL da base. Repetir uma coleta não transforma a comparação em zero. Novas publicações também promovem a última referência válida à base; fontes distintas não são misturadas. Sem base válida, aparece **Sem base**; zero verdadeiro permanece neutro, alta verde e baixa vermelha.

O painel **Fontes e horários** informa a base e oferece **Histórico de 7 dias** por indicador. A ação autenticada `billing_rpc('dashboard-market','history',{id})` retorna a última coleta de cada dia de Brasília (até sete), preservando a data de publicação e a fonte de cada linha. O frontend apenas formata os dados; não calcula percentuais.

A leitura agrícola na Edge extrai apenas os XMLs e as colunas necessárias da mesma planilha, sem montar objetos ExcelJS para suas centenas de milhares de células. Os limites de download e descompactação são verificados. Ela reutiliza o parser canônico de produto, praça e preço mais comum; não muda a origem dos indicadores.

A última resposta válida é guardada no navegador por usuário e grupo. Ela inicializa o cache da próxima visita como desatualizada, sem alterar preços, datas ou horários, e uma nova consulta começa imediatamente. Respostas inválidas, indisponíveis ou anteriores não apagam a última publicação válida. O armazenamento local é opcional; sua ausência não impede a consulta.

O parâmetro de grupo é opcional para compatibilidade com consumidores antigos. A resposta sem grupo lê todos os indicadores do banco; a barra usa exclusivamente as consultas separadas.

Após aplicar as migrations e publicar somente `dashboard-market-refresh` no projeto autorizado, `node scripts/configure-dashboard-market.mjs` provisiona/reutiliza o token e faz a primeira coleta. O script confere o vínculo e o CLI autenticado; o arquivo temporário de segredo fica no diretório temporário do sistema e é removido ao terminar. Falhas e execuções podem ser inspecionadas em `market_refresh_state`, `cron.job_run_details` e nos logs da função, sem consultar valores secretos.

## Verificação

`npm run test:dashboard` inclui testes de provedores, leitura XLSX na Edge, autenticação do worker, leases, precisão, regressão de publicações, isolamento da RPC, persistência no navegador, consultas independentes e movimento. TypeScript e build também devem passar após mudanças de integração.
