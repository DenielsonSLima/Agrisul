# Solicitações de serviço e assinaturas

Contrato público: `billing_rpc(resource, action, payload)`. Solicitantes são pessoas cadastradas pelo nome, com PNG opcional, sem precisar de conta. O operador autenticado seleciona a pessoa e sua autoria fica registrada separadamente. O proprietário do espaço e o usuário de cada evento são derivados da sessão. Valores monetários retornam como texto decimal; datas de eventos são timestamps do banco truncados para segundos. Requisições enviadas e seus arquivos são imutáveis. A decisão pelo mesmo diretor geral que operou o cadastro é permitida quando ele possui a permissão necessária e seu cadastro vinculado à conta.

Permissões novas: `requests.read`, `requests.write`, `requests.approve`, `signatures.manage`. Escrita e aprovação exigem também consulta. Administrador recebe todas; Somente leitura recebe consulta. Cadastro de assinatura não concede permissão de aprovação.

## Assinaturas (`signatures`)

- `options {}` → `{users:[{id,name}],canManage}`. Usuários são membros ativos do espaço, usados apenas para vincular gerentes; não exige `users.manage`.
- `list {search?,page?,pageSize?,status?:'active'|'inactive'|'all'}` → `{items,total,page,pageSize}`.
- `prepare-upload {fileName,contentType:'image/png',size}` → `{file:{id,bucket,path,fileName,contentType,size}}`. PNG até 3 MiB, bucket privado `billing-signatures`.
- Enviar arquivo com Storage `upload(path,file,{upsert:false,contentType})` antes de salvar.
- `save {id?,name,userId?:uuid|null,role:'requester'|'manager',fileId?:uuid|null,active?:true}` → `{signature}`. Solicitante (`requester`) exige `userId` omitido ou null e não depende de conta/membership. Diretor geral (role técnico `manager`) exige `userId` de membro ativo. PNG é opcional em ambas as funções. Na edição, omitir `fileId` preserva o PNG; informar null remove seu uso em novos documentos e preserva os arquivos antigos. Salvar sempre ativa/reativa. Um usuário tem no máximo um cadastro de diretor ativo. Pessoas solicitantes têm identidade própria por `id` da assinatura.
- `deactivate {id}` → `{signature}`. Não altera imagens e nomes registrados em solicitações anteriores.
- Signature: `{id,name,userId:uuid|null,role,fileId:uuid|null,filePath:string|null,active,createdAt,updatedAt}`.

## Serviço (`service-requests`)

- `options {}` → `{requesters:[{id:signatureId,name}],requesterSignatures:Signature[],managerSignature:Signature|null,canCreate,canDecide,actorId}`. `requesterSignatures` contém pessoas solicitantes ativas para seleção no formulário; `requesters` inclui pessoas inativas/históricas para filtro. `managerSignature` é exclusivamente a assinatura de gerente do usuário logado. Não existe mais singleton `requesterSignature` da conta.
- `prepare-upload {requestId:uuid,fileName,contentType,size}` → `{file}`. Orçamento PDF/JPG/PNG até 10 MiB, bucket privado `billing-request-files`. `requestId` é UUID do formulário, preservado em repetição após erro de transporte.
- Enviar arquivo com Storage `upload(path,file,{upsert:false,contentType})`. Não há política de UPDATE/DELETE; arquivos preservam evidência inclusive após envio/decisão.
- `create {requestId:uuid,requesterSignatureId:uuid,requesterSigningMode?:'registered'|'manual',companyName,companyAddress,items:[{description,application}],serviceValue?:text|null,returnDate?:null|string,notes,attachmentIds?:uuid[]}` → `{request}`. Aceita de 0 a 5 orçamentos enviados; `attachmentIds:[]` permite emitir antes de receber o orçamento. Exige seleção de pessoa ativa `requester` deste espaço; o operador não precisa ter assinatura própria. Modo padrão: `registered` se existe PNG, `manual` caso contrário. `manual` pode ser escolhido mesmo com PNG cadastrado, deixando a linha para assinatura física. `registered` exige PNG. Valor não negativo com até 2 decimais. Repetição idêntica pelo mesmo operador é idempotente; mudar conteúdo, pessoa, modo escolhido ou operador com mesmo UUID gera conflito. Um retry que omite modo reutiliza o modo original, mesmo se o cadastro recebeu PNG depois.
- `list {search?,dateFrom?,dateTo?,requesterId?:signatureId,tab?:'pending'|'in_progress'|'finished',page?,pageSize?}` → `{items,total,page,pageSize,counts:{pending,inProgress,finished}}`. O filtro usa a identidade da assinatura/pessoa, nunca o UUID da conta operadora. Período considera data civil de criação em America/Sao_Paulo, limites inclusivos. Counts compartilham os filtros e independem da aba. Páginas são limitadas à última disponível após mudança dos resultados.
- `get {id}` → `{request}`.
- `decide {id,decision:'approved'|'rejected',reason,managerSigningMode?:'registered'|'manual'}` → `{request}`. Só pendentes; bloqueio transacional; exige `requests.approve` e cadastro ativo `manager` vinculado ao próprio ator. O PNG é opcional: padrão `registered` se existe, `manual` sem PNG; modo manual explícito é permitido mesmo com imagem. Recusa exige motivo de 3 a 2000 caracteres. Repetição idêntica pelo mesmo ator e modo retorna a decisão existente; outra decisão falha.
- Request: `{id,number,status:'pending'|'approved'|'rejected',companyName,companyAddress,items,serviceValue,returnDate,notes,createdAt,createdBy:{userId,name},requester:{userId:null|legacyUserId,name,signatureId,signaturePath:string|null,signingMode,signatureHash:string|null},decision:null|{userId,name,signatureId,signaturePath:string|null,signingMode,signatureHash:string|null,at,reason},template:DocumentTemplate,documentHash:string,attachments:[file],history:[{id,action:'created'|'approved'|'rejected',actorId,actorName,signaturePath:string|null,signingMode,signatureHash:string|null,at,reason}],canDecide}`. `createdBy` identifica a conta operadora real. O evento `created` registra esse mesmo operador e nome da conta; `signaturePath`, quando presente, pertence à pessoa solicitante escolhida, sem atribuir a ela um login. Modo manual sempre mantém caminho e hash de assinatura null, inclusive se o cadastro recebe PNG futuramente.
- `canDecide` de cada registro inclui status e assinatura; options.canDecide representa permissão global de aprovação. `canCreate` representa permissão de escrita.

## Modelos (`document-templates`)

- `list {}` → `{items:DocumentTemplate[],canManage}`; atualmente oferece o modelo `service-request`.
- `get {key:'service-request'}` → `{template:DocumentTemplate,canManage}`.
- `save {key:'service-request',name,layout,expectedVersion}` → `{template:DocumentTemplate}`. `expectedVersion` é obrigatório; versão 0 é o modelo padrão ainda não personalizado. Cada salvamento incrementa a versão; um salvamento com versão desatualizada falha com `40001`.
- `DocumentTemplate = {key:'service-request',name,module:'requests',version,layout,updatedAt:string|null,updatedBy:uuid|null}`. Consulta exige `requests.read` ou `report-headers.read`; alteração exige `report-headers.write`. São reutilizadas as permissões existentes.
- `layout = {page:{width:210,height:297},blocks:Block[]}`. De 1 a 40 blocos dentro dos limites da página A4, com dimensões positivas em milímetros.
- `Block = {id,type:'text'|'field'|'items'|'signature'|'verification'|'line',x,y,width,height,text?,field?,fontSize?,fontFamily?:'sans'|'serif'|'mono',fontWeight?:'normal'|'bold',align?:'left'|'center'|'right'}`. IDs únicos `[a-zA-Z0-9_-]{1,60}`; fontes entre 8 e 28 pontos; texto com até 2000 caracteres. Nenhum HTML, script ou chave desconhecida é aceito.
- `field` em blocos de dados: `requestNumber`, `companyName`, `companyAddress`, `serviceValue`, `returnDate`, `notes`, `requesterName`, `directorName`, `createdAt`, `decidedAt`, `createdByName`, `status`, `verificationCode`. Em blocos de assinatura: `requester` ou `director`.
- Cada solicitação recebe uma cópia imutável do modelo vigente. Editar o modelo só afeta novas solicitações. O PDF usa `request.template`, nunca consulta o modelo atual para substituir o histórico.

## Hashes de conferência

O Postgres calcula SHA-256 sobre JSONB canônico com conteúdo original, pessoa, operador, caminhos imutáveis de PNG, timestamps, anexos e snapshot do modelo. `documentHash` identifica o registro original e permanece igual depois da decisão. O hash do solicitante registrado vincula `documentHash`, pessoa, operador, caminho e hora; o hash do diretor registrado também inclui decisão e motivo. Assinaturas manuais têm `signatureHash:null`.

Os hashes identificam os registros internos: não são certificados de assinatura digital nem checksum dos bytes do PNG. O QR leva ao registro autenticado com `?verificar=<documentHash>`; não existe endpoint público de documentos ou assinaturas.

Tabelas Realtime: `billing_signatures`, `billing_request_files`, `billing_service_requests`, `billing_service_request_events`, `billing_document_templates`. As tabelas têm SELECT com RLS e nenhuma concessão de escrita direta. Mudanças de permissões e membros exigem invalidar também esses recursos.

A migration de pessoas desvincula as assinaturas requester antigas das contas e adiciona autoria às solicitações já existentes a partir do evento original/ator antigo. Nomes, imagens, timestamps, decisões e eventos já registrados são preservados. O nome de autoria de registros antigos conserva a informação histórica disponível, sem reinterpretá-la como nome atual da conta.
## Marca d’água

O editor, a prévia e todas as páginas do PDF usam a marca d’água de retrato salva em Configurações, com a mesma opacidade e tamanho. A imagem permanece no bucket privado e é carregada por URL assinada. A identidade visual acompanha a configuração atual; o layout e o conteúdo da solicitação continuam preservados no snapshot original. `requests.read` permite consultar essa identidade e seus arquivos no próprio espaço, sem conceder alteração da configuração. O detalhe apresenta os dados em cartões responsivos; a papelaria fica nas folhas do documento.

## Cabeçalho padrão dos relatórios

`service-requests/document-brand {}` retorna `{company,header}` com a empresa e a configuração de retrato resolvidas no Postgres. Prioridade da empresa: padrão do cabeçalho, principal, primeira por nome/ID. Sem empresa, retorna null. A consulta exige `requests.read` ou `report-headers.read`; campos adicionais no payload são recusados. Não concede edição de empresas ou cabeçalhos.

Editor, prévia e todas as páginas do PDF reutilizam `ReportHeader`/`drawReportPdfHeader`. O logo vem do bucket privado `billing-company-logos` por URL assinada. Operadores com `requests.read` acessam somente a empresa selecionada e seu logo; mudanças de empresa/configuração invalidam `service-requests` por Realtime e nas mutations locais.

O cabeçalho acompanha a configuração atual, assim como a marca d’água. O modelo padrão usa a área entre 47 e 285 mm. A apresentação reconhece as versões exatas do modelo inicial antigo e organiza seus dados no padrão atual. Modelos antigos personalizados com a estrutura original de cabeçalho conservam a adaptação anterior entre 55 e 283 mm; os demais mantêm suas coordenadas. Textos personalizados são preservados. Os snapshots, as assinaturas e os hashes persistidos não são regravados por essa adaptação visual.

A prévia abre o PDF completo produzido pelo mesmo gerador da exportação, incluindo continuações e auditoria. Alterar o tamanho da tela mantém o arquivo carregado; alterações na identidade visual regeneram a prévia. Fechar o modal aborta a preparação, revoga sua URL temporária e devolve o foco ao botão de abertura.

## Prestador cadastrado

O modal seleciona `providerId` de Cadastros → Prestador. Nome, documento e endereço são resolvidos pelo Postgres e retornam em `provider`/`providerId`, com `companyName` e `companyAddress` preservados para o modelo e PDF. O snapshot do prestador é imutável e incluído no hash dos novos documentos. Edições posteriores no cadastro não alteram os registros emitidos. Veja o contrato em `../cadastro/prestadores/CONTRACT.md`.

## Dados opcionais e complementação após a criação

Na criação, valor, previsão de retorno e orçamento são opcionais. Valor ausente, vazio ou null é armazenado como null; zero continua sendo um valor informado. O formulário envia null para campos em branco e [] para anexos. O PDF deixa os campos desconhecidos livres para preenchimento manual.

`complement {id,operationId,expectedComplementId,serviceValue:null|text,returnDate:null|YYYY-MM-DD,attachmentIds:uuid[]}` exige `requests.write` e solicitação pendente ou aprovada. Solicitações recusadas não recebem novos dados ou anexos. O formulário permite acrescentar valor, previsão e novos anexos. O total de anexos permanece limitado a cinco; arquivos anteriores não são removidos ou substituídos. Cada chamada registra versão, usuário autenticado, data/hora/segundos, dados completos, situação no momento (`recordedStatus`) e hash encadeado ao documento original e complemento anterior.

A tabela `billing_service_request_complements` é append-only pela RPC, com SELECT/RLS e sem DML direto. Row lock, UUID de operação e `expectedComplementId` protegem repetições e edições simultâneas. Realtime invalida `service-requests`. `canComplement` é calculado no banco. `currentDetails` apresenta os valores atuais e `complements` preserva cada alteração; `serviceValue`, `returnDate`, modelo, hashes e assinaturas originais permanecem imutáveis. A tela mostra o histórico combinado, e prévia/PDF incluem complementações identificadas como anteriores à decisão ou posteriores à aprovação, inclusive em pedidos pendentes com assinatura manual.

`decide` também recebe `expectedComplementId`, o ID da última complementação examinada (null se não houver). O banco recusa uma decisão sobre versão desatualizada com `23505`, sob o mesmo bloqueio da solicitação. `decisionComplementHash` preserva o hash dessa versão e passa a integrar o hash da assinatura PNG do diretor. Complementos posteriores não alteram a decisão nem reaplicam sua assinatura. Decisões históricas conservam seus hashes anteriores.

A lista abre em cards (`components/ServiceRequestCard.tsx`) e oferece alternância para tabela. São quatro colunas no desktop, duas em telas menores e uma no celular, com 12 registros por página. Cada card exibe documento e cidade/UF do snapshot do prestador, solicitante e indicação dos orçamentos. A visualização é preservada na URL junto dos filtros, aba e página. Os dois formatos usam a mesma coleção paginada e os valores de `currentDetails` retornados pelo banco.

O botão de orçamento abre `RequestAttachmentPreview` em modal. A seleção troca entre PDF e imagens anexados, carregados somente ao abrir, pelo bucket privado e URL temporária. Fechar devolve o foco ao botão do card; trocar de conta desmonta a prévia. O link de abrir a solicitação e o botão de prévia são controles independentes.

## Situação de execução do serviço

A decisão original continua em `status: pending|approved|rejected`. O Postgres retorna `workflowStatus: open|in_progress|finished|rejected`: Aberto na criação, Em andamento após a aprovação, Finalizado após o registro da conclusão, Recusado quando o diretor recusa. Aprovação não significa conclusão do serviço. Registros aprovados antes desta mudança passam a aparecer Em andamento; nenhuma conclusão histórica é inferida.

`complete {id}` exige consulta e escrita (`requests.read`, `requests.write`), permite apenas serviços aprovados e registra `completion:{at,userId,name}` e o evento `completed`. A decisão, suas assinaturas, hashes e o documento original ficam preservados. A RPC serializa pelo registro e é idempotente; não aceita usuário/data enviados pelo cliente. `canComplete` é calculado no servidor. A conclusão não remove a possibilidade já existente de complementar dados e anexos de solicitações aprovadas.

`list.tab` aceita `pending`, `in_progress` e `finished`. As abas Abertas, Em andamento e Finalizadas usam respectivamente pedidos aguardando decisão, aprovados sem conclusão e concluídos/recusados. `counts:{pending,inProgress,finished}` usa os mesmos filtros, independentemente da aba. O PDF registra a execução e a conclusão no histórico de auditoria.
