# Solicitações de serviço

O fluxo substitui o formulário interno em papel: um operador seleciona a pessoa que pediu o serviço, registra os dados e anexa o orçamento; o gerente consulta o documento, aprova ou recusa. O solicitante precisa apenas de nome e assinatura cadastrados, sem conta no sistema. A solicitação finalizada preserva os arquivos, os nomes e as assinaturas usados naquela ocasião.

## Preparação

1. Em **Configurações → Perfis de acesso**, conceda **Consultar solicitações** e **Registrar solicitações** aos operadores que vão lançar pedidos. Para gerentes, conceda também **Aprovar e recusar como gerente**. O perfil Administrador já inclui essas permissões.
2. A pessoa responsável pelo cadastro precisa de **Cadastrar e administrar assinaturas**. Cadastrar uma assinatura de gerente não concede permissão de aprovação.
3. Em **Cadastros → Assinaturas**, escolha **Solicitante**, informe o nome da pessoa (por exemplo, Edmilson) e, se desejar, envie o PNG, com até 3 MB. Não é necessário criar usuário ou convite para essa pessoa.
4. Para cadastrar uma assinatura de **Gerente**, escolha essa função e vincule a conta que fará a aprovação. Prefira imagem com fundo transparente.

## Uso diário

Abra **Solicitações → Serviço → Nova solicitação**. Selecione **quem solicitou o serviço** entre as pessoas cadastradas. Selecione o prestador cadastrado e informe a descrição de cada equipamento/material e sua aplicação. Valor, previsão de retorno, observações e orçamento são opcionais. Você pode enviar sem esses dados ou preenchê-los desde o início. Os anexos aceitam PDF, PNG ou JPEG, com até 10 MB cada e até cinco arquivos.

O documento usa o nome e a assinatura da pessoa selecionada. O campo **Registrado no sistema por** e o histórico identificam separadamente o usuário que fez o lançamento. O operador não precisa ter assinatura própria para registrar pedidos em nome de outras pessoas. A solicitação recebe número sequencial no espaço e aparece em **Pendentes**. Use a busca, as datas e o filtro por solicitante para localizar registros. A paginação acontece no servidor.

O gerente abre a solicitação, confere os orçamentos e confirma **Aprovar solicitação** ou **Recusar**. A recusa exige motivo. Conforme a escolha do usuário para este projeto, o gerente também pode aprovar a própria solicitação.

**Finalizadas** reúne aprovadas e recusadas, identificadas pela situação. O detalhe mostra o histórico, o identificador do usuário e os horários de Brasília, incluindo segundos. O botão **Exportar PDF** gera o documento com assinaturas e histórico; os orçamentos originais continuam disponíveis no detalhe.

O editor de modelos, a prévia e o PDF usam a identidade definida em **Configurações → Cabeçalho de relatórios**, na orientação retrato: empresa, logo, CNPJ, endereço e contato, conforme as opções habilitadas. A marca d’água configurada também é mantida. O cabeçalho se repete nas páginas de continuação e de histórico; os campos e textos do corpo continuam editáveis em **Cadastros → Modelos de documentos**.

## Preservação dos registros

- Depois da aprovação, abra a solicitação em **Finalizadas** e clique em **Complementar dados** para informar valor, previsão de retorno e anexos. É necessário ter permissão para registrar solicitações.
- O documento original e a decisão permanecem preservados. Cada complementação registra usuário, data e hora no histórico e aparece na prévia e no PDF.
- Alterar ou inativar uma assinatura vale para novos registros. Os documentos anteriores conservam a assinatura original.
- Arquivos ficam em buckets privados e são abertos por links temporários.
- Repetir o mesmo envio após falha de conexão não duplica a solicitação. Decisões concorrentes são controladas pelo banco.

## Etapas da implementação

1. Revisão conjunta dos campos do formulário, das permissões e dos registros de aprovação.
2. Banco: RPCs, isolamento por espaço, assinaturas, anexos privados, filtros, paginação e histórico.
3. Interface: cadastro, formulário, consulta, análise do gerente, notificações e PDF.
4. Integração: menus, busca de módulos, perfis de acesso e atualização por Realtime.
5. Validação: TypeScript, testes de banco e serviços, build e fluxo remoto com identidades temporárias.

O contrato técnico está em [CONTRACT.md](./CONTRACT.md).
