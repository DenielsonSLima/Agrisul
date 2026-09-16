# Controle de Faturamento

## Integração Supabase atual — 15/09/2026

Configurações, Cadastros e contratos operacionais usam Supabase Auth, RPC PostgreSQL, Storage privado, Realtime e TanStack Query. Veja [LEIA-ME-VSCODE.md](LEIA-ME-VSCODE.md) para executar e [AGENTS.md](AGENTS.md) para as regras obrigatórias do projeto. As migrations estão em `supabase/migrations/`.

As anotações abaixo são o histórico da versão D1/ChatGPT anterior e não descrevem a persistência dos módulos migrados. Nenhum dado remoto antigo foi importado.


Interface modular em português para Início, Cadastro, Contratos, Resumo, Agenda e Configurações.

Estado atual: Configurações contém pastas independentes para empresas, usuarios e marca-dagua. Os cards são compactos, com grade de quatro colunas no desktop; cada submódulo abre isoladamente, com retorno às configurações. Empresas possui cadastro e edição, principal e unidades, consulta gratuita por CNPJ via BrasilAPI e dados editáveis de identificação, endereço e contato. A consulta só acontece por ação do usuário, no servidor, com autenticação e timeout; não salva automaticamente. Os cadastros são persistidos em D1 e isolados pelo usuário autenticado via ChatGPT. Marca d’água possui editor com envio de PNG/JPG/WebP, orientação retrato/paisagem, opacidade, tamanho e prévia A4. Os ajustes são privados por usuário, persistidos em D1, e as imagens ficam em R2. Usuários e os demais módulos principais mostram “Em desenvolvimento”.

## Organização

Cada domínio em `modules/` possui suas próprias pastas:

- `components/`: páginas e componentes de apresentação do módulo.
- `forms/`: formulários e controles de entrada do módulo.
- `hooks/`: integração da interface com as regras e o estado.
- `services/`: validação de operações e transformação de dados.
- `utils/`: funções específicas do domínio.

`shared/components/` contém o layout, a busca global e elementos comuns. `shared/state/` contém o estado compartilhado da sessão e dados fictícios. `shared/types.ts` define os contratos de dados. `shared/utils/` reúne formatação reutilizável. `components/ui/` contém os componentes acessíveis do kit de interface.

Os módulos Início e Resumo compõem indicadores a partir dos registros de Cadastro e Contratos. A Agenda é a fonte de compromissos do Início. A busca global navega até o módulo correspondente com o filtro ou dia selecionado.

## Comportamento

- Menu lateral escuro com módulo ativo em verde-claro; menu recolhível no celular.
- Busca global por módulos, clientes, contratos e compromissos, com atalho Ctrl/⌘ K.
- Criação e edição de clientes e contratos; validação dos campos obrigatórios e valores.
- Resumos calculados a partir dos contratos, com filtro de período por vencimento.
- Calendário com navegação entre meses, criação e conclusão de compromissos.
- Preferências de identificação e densidade das tabelas.

## Limites da demonstração

As telas operacionais antigas usavam registros fictícios de sessão e estão desativadas. O novo cadastro de Empresas é persistente em D1; seus dados permanecem após recarregar a página. Não há envio de mensagens, cobrança, assinatura de contratos ou gerenciamento de usuários do produto. Empresas exige identidade ChatGPT para ler ou gravar dados privados por conta. O acesso privado do ambiente hospedado é separado de uma futura autenticação do produto.

A interface considera 14/09/2026 como o dia da demonstração. Indicadores representam valores de contratos por vencimento, não receita recebida.

Para persistência real, substitua a integração de estado dos hooks por chamadas de API nos services, com validação no servidor, autenticação e autorização por usuário. Mantenha formulários e regras separados; não coloque operações de banco nos componentes.

## Desenvolvimento e verificação

O projeto usa React, TypeScript, Vinext, Tailwind e componentes Shadcn. Preserve o `pnpm-lock.yaml`. Os scripts de build e instalação são gerenciados pelo fluxo Sites.

Verificado com TypeScript (`tsc --noEmit`) e build de produção. Testes de navegador não foram solicitados. A ferramenta WebMCP antiga foi removida ao desativar as telas de demonstração.


## Empresas: validação do servidor

`node tests/companies-api.test.mjs` testa as rotas reais com SQLite em memória e identidades locais fictícias: autenticação, isolamento por proprietário, cadastro principal/unidade, promoção da principal, rollback em CNPJ duplicado, persistência de endereço e contato, preservação de credenciais legadas, resposta sem segredos e validação de origem. Nenhum registro de teste é criado no ambiente publicado.

`node tests/cnpj-lookup.test.mjs` verifica a consulta com respostas simuladas do provedor: autenticação, normalização, mapeamento, contatos ausentes e indisponibilidade. A integração utiliza https://brasilapi.com.br/api/cnpj/v1/{cnpj}, projeto independente com dados públicos da Receita Federal.

A variável secreta legada COMPANY_KEY_ENCRYPTION_KEY contém a chave AES de 256 bits em Base64 e deve ser preservada para as credenciais existentes. Não a altere sem um procedimento de rotação. As migrações Drizzle são versionadas em drizzle/.

`node tests/watermark-api.test.mjs` verifica autenticação, isolamento da imagem, persistência dos ajustes, validação de arquivos, falha de salvamento e remoção. O editor apresenta uma prévia; os módulos de emissão de documentos ainda estão em desenvolvimento.

Cadastro agora possui submódulos no menu lateral: Clientes, ATR, Fazenda, Talhões e Contratos, cada um com subpasta própria. ATR, Fazenda, Talhões e Contratos exibem “Em desenvolvimento”. A navegação usa o parâmetro `secao`, preserva acesso direto, histórico e busca global.

Clientes é um cadastro persistente de parceiros, independente das Empresas de Configurações (organizações usuárias do sistema). As tabelas clients e companies não compartilham registros, regras de empresa principal nem cadastros. Somente a consulta pública de CNPJ, os tipos de dados cadastrais e a formatação são comuns. A lista tem quatro cards por linha no desktop e navega para páginas de detalhes e edição com breadcrumb. O formulário Novo parceiro consulta o CNPJ opcionalmente e salva somente após revisão. Os endpoints /api/clients têm autorização por proprietário, validação e restrição de CNPJ único por conta. Nenhum parceiro de demonstração é inserido.

`node tests/clients-api.test.mjs` verifica os endpoints reais com SQLite local: criação, leitura direta, edição, isolamento por usuário, CNPJ duplicado, consulta e independência das Empresas (inclusive o mesmo CNPJ nos dois cadastros).

O módulo é exibido como Cadastros no menu, busca e caminhos de navegação. Culturas e Manejo têm subpastas independentes. O endereço /cadastro permanece compatível com os links existentes.

Planejamento e Acompanhamento são módulos principais em pastas independentes, com telas “Em desenvolvimento”. A árvore de Cadastros abre ao entrar no módulo e recolhe ao navegar para qualquer outro módulo, inclusive pela busca ou pelo histórico.

ATR registra mês, ano e valor decimal sem impor moeda/unidade. Os registros são persistidos por usuário em atr_records, com unicidade de mês/ano. A interface agrupa por ano em ordem decrescente, apresenta os 12 meses e permite cadastrar ausentes ou editar existentes. Meses sem registro são somente espaços de navegação, não dados salvos.

Fazenda possui cadastro e edição com nome, área em hectares, cidade e UF. Os cards usam quatro colunas no desktop, duas no tablet e uma no celular. Dados persistem em farms, privados por usuário; área decimal é armazenada como texto para preservar a precisão. O formulário aceita vírgula ou ponto decimal, sem separadores de milhar.

Talhões lista as fazendas reais de Cadastros; cada fazenda abre seus próprios talhões, com nome, área, total utilizado e saldo. As áreas são somadas em milionésimos inteiros de hectare para preservar decimais. Criação/edição de talhão e redução da área da fazenda usam predicados de capacidade na mesma instrução SQL de escrita, prevenindo excesso inclusive entre requisições concorrentes. O armazenamento é farm_plots com vínculo à fazenda e autorização pelo proprietário da fazenda.

Cadastros → Contratos configura tipos de contrato (por exemplo, manual e semimecanizado), cada um com suas próprias etapas ordenadas. Os tipos são privados por usuário, persistidos em contract_types; a lista JSON de etapas é gravada atomicamente junto ao nome e preserva os identificadores ao reordenar. As sugestões abrem formulários e não inserem dados automaticamente.

Culturas organiza cultura principal → subtipos (ex.: Cana → Cana soca / Cana planta). Cada cultura tem página própria, com criação/edição dos subtipos vinculados. Dados persistem em cultures e culture_subtypes com autorização por proprietário, unicidade dos nomes no respectivo nível e vínculos independentes.

Manejo organiza operações vinculadas à cultura e ao tipo ou estágio (por exemplo, Cana planta ou Cana soca). As operações são agrupadas em Preparo do Solo, Tratos Culturais e Manejo da Soqueira; vínculos, catálogo e unicidade são validados pela RPC no Postgres.
