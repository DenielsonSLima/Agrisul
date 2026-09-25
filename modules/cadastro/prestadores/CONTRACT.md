# Prestadores de serviço

Cadastros → Prestador utiliza o mesmo layout de cartões, identificação, endereço e contato de Clientes. Inclusão e edição abrem em modal; o modal também pode ser aberto dentro da nova solicitação, preservando o formulário em andamento. Solicitantes continuam independentes dos prestadores.

O frontend usa `billing_rpc('service-providers', action, payload)`:

- `list {}` e `options {}` retornam `{providers,canManage}`, ordenados pelo nome.
- `get {id}` retorna `{provider,contacts,canManage}`. `contacts` contém os contatos ativos ordenados pelo nome.
- `save {id?,documentType,document,legalName,tradeName,street,number,complement,district,city,state,zipCode,phone,email}` retorna `{provider}`. `id` somente para atualização de um prestador existente no espaço.
- `save-contact {id?,providerId,name,phone}` retorna `{contact}` e `delete-contact {id}` remove o contato das escolhas futuras sem apagar o histórico dos pedidos.

`documentType` é `CPF` ou `CNPJ`; `document` contém o documento normalizado. O Postgres valida dígitos verificadores, rejeita documentos repetidos dentro do mesmo espaço, normaliza UF/CEP e valida os limites de todos os campos. A consulta de CNPJ reaproveita o serviço autenticado e o cache já usados por Clientes. CPF é preenchido manualmente. O cálculo de DV do CNPJ numérico/alfanumérico segue o [manual da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf).

Consulta exige `registrations.read` ou `requests.read`; escrita exige `registrations.write`. Não há novas permissões administrativas. A tabela `billing_service_providers` possui RLS, SELECT para Realtime e nenhuma gravação direta para `authenticated`. O proprietário vem exclusivamente da sessão. Alterações invalidam `service-providers` e `service-requests`; formulários são desmontados ao trocar de conta.

Cada prestador pode ter vários registros em `billing_service_provider_contacts`. A aba Contatos cadastra o nome do responsável e seu telefone. A tabela também tem RLS por proprietário, leitura apenas para Realtime e escrita exclusivamente pelas ações da RPC. Exclusão é lógica para manter as FKs e os snapshots de pedidos já emitidos; contatos removidos deixam de aparecer nas novas escolhas.

Ao preencher uma ordem de compra, o usuário seleciona um contato ativo do mesmo prestador. O Postgres valida o vínculo e grava `provider_contact_id` com `provider_contact_snapshot`; número da OC não pode ser salvo sem o contato responsável. O detalhe e o PDF do pedido mostram `RESP.` e `CONT.` a partir do snapshot, portanto edições ou exclusões posteriores não alteram o documento histórico.

Novas solicitações da interface enviam `providerId`. O servidor busca nome e endereço e grava `provider_id`/`provider_snapshot`, protegidos por FK composta pelo proprietário. Dados enviados como `companyName`/`companyAddress` junto ao ID são substituídos pelos dados autorizados do cadastro. Alterar o prestador depois não modifica documentos emitidos; tentativas repetidas da mesma solicitação reaproveitam o snapshot original. O snapshot entra no hash do documento e, por consequência, na evidência das assinaturas PNG. Solicitações antigas e os hashes anteriores permanecem intactos; o contrato anterior com nome/endereço livres continua aceito para compatibilidade.

O campo Prestador da solicitação combina busca e seleção. Clicar abre os prestadores disponíveis; digitar filtra nome/razão social, nome fantasia, CPF ou CNPJ, ignorando acentos e a pontuação do documento. A seleção aceita mouse ou teclado. Alterar o texto limpa a seleção anterior até que uma opção seja escolhida. O cadastro pelo modal continua selecionando automaticamente o novo prestador e preservando o rascunho.
