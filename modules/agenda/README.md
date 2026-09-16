# Agenda, Resumo e Relatórios

A Agenda apresenta os dias reais do mês selecionado (28, 29, 30 ou 31), os resumos dentro de cada dia, a legenda lateral e os detalhes do dia selecionado. A legenda também filtra os tipos de evento. O calendário usa apenas os registros da empresa ativa.

O botão **Exportar PDF** abre um modal com prévia completa, download e impressão. O PDF A4 em retrato apresenta cabeçalho, legenda e calendário na metade superior da primeira folha, inclusive nos meses com seis semanas. Cada dia mostra sua contagem de eventos e as cores dos tipos presentes. Os resumos completos e todos os registros começam logo abaixo, aproveitando a mesma folha e seguindo em novas páginas conforme o volume. Datas e identificação do evento são repetidas nas continuações de textos longos. Usa um snapshot do mês/filtro da RPC, sem recalcular totais, e o cabeçalho/marca d'água de retrato configurados para a empresa. A exportação fica indisponível enquanto a consulta carrega ou atualiza. O modal compartilhado fica em `shared/reporting/PdfExportDialog.tsx`; a orquestração, o calendário e a paginação dos detalhes ficam separados em `modules/agenda/reporting/agendaPdf.ts`, `agendaPdfCalendar.ts` e `agendaPdfDetails.ts`.

Os eventos são projeções dos registros existentes: inclusão do contrato (data de criação em `America/Sao_Paulo`), início e término previstos, carregamentos, recebimentos e adiantamentos. Não existe gravação de cópias desses eventos. A edição ou exclusão na origem aparece na próxima consulta. A Agenda usa a data do recebimento; o Resumo e o relatório financeiro usam sua competência.

Cada módulo possui tipos, serviços, hooks e componentes próprios. Os serviços chamam `billing_rpc` com os recursos `agenda`, `summary` e `reports`. Contagens, agrupamentos diários, volumes, saldos e totais ficam no Postgres. O navegador faz somente navegação por datas, formatação e geometria do calendário/PDF.

`shared/query/useBillingQuery.ts` inclui usuário, recurso, empresa e filtros nas chaves. `derivedResources.ts` mantém as dependências das mutations, com cancelamento e invalidação aguardada, e alimenta o mapa do Realtime central em `DataProvider`. Reconexões continuam reconsultando as RPCs. A troca de conta e empresa desmonta as telas e suas prévias.

Relatórios oferece contratos (cadastro atual), carregamentos (data no mês), financeiro (competência no mês) e fazendas (cadastro de todo o espaço de trabalho). A prévia e o PDF usam o mesmo snapshot e as configurações de cabeçalho/marca d'água. O banco mantém créditos de contratos separados e sinaliza valores sem ATR/cotação como pendentes.

Acompanhamento foi removido, seus apontamentos foram apagados e suas RPCs foram desativadas. Planejamento agora possui períodos livres, metas e distribuição por talhão; o contrato vigente está documentado em `modules/planejamento/README.md`. Contratos, carregamentos, financeiro e cadastros foram preservados. O link antigo de Acompanhamento redireciona para Resumo.

Validação: `npm test`, `node node_modules/typescript/bin/tsc --noEmit` e `npm run build`. O teste opcional `tests/agenda-supabase-live.test.mjs` exige `BILLING_RUN_LIVE_TESTS=1`, verifica o projeto `rbuscpwntzpyqsuycqmv`, cria identidades efêmeras e remove apenas as identidades criadas. Com `BILLING_BROWSER_CDP`, verifica também o navegador, Realtime por outra conexão e o PDF.
