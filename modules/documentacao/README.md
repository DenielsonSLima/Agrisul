# Documentação

Central `/documentacao`, com abas Documentos e Pendências. Os mesmos registros aparecem na aba Documentação de Serviços, Cotações, Pedidos e Prestadores. A pasta de uma referência é uma consulta dos vínculos, sem cópia de arquivos.

- Cada documento reúne até 30 arquivos de até 10 MiB: PDF, JPEG, PNG, WebP e XML. Imagens/PDF têm prévia privada; XML é disponibilizado para download.
- Tipos: solicitação de serviço, solicitação de compras, nota fiscal, orçamento, boleto, comprovante de pagamento, comprovante de entrega, foto e outro.
- Dados opcionais: número, emissão, vencimento, valor decimal, prestador, empresa destinatária e observação. As referências de serviço/pedido resolvem o prestador no servidor. Referências de fornecedores diferentes são recusadas.
- Um documento admite várias referências. Sem vínculo, aparece aguardando identificação. Boletos/comprovantes podem ser relacionados a um documento principal do mesmo fornecedor/empresa, permitindo várias parcelas. Esses vínculos não registram quitação ou entrega física.
- Situações: a conferir, conferido, divergente, cancelado e substituído. Edição de dados ou adição de arquivos reinicia a conferência. Arquivos consumidos, documentos cancelados/substituídos e eventos anteriores são preservados.
- Exigências são explícitas por referência/tipo, com prazo e observação. Podem existir antes do primeiro arquivo. Boleto não é exigido automaticamente. Orçamentos já anexados ao serviço ou à cotação são reaproveitados; a documentação da cotação também aparece no pedido originado dela.
- Pendências são calculadas no Postgres: documento esperado ausente, a conferir, divergente ou sem identificação. O prazo é civil de Brasília; vencimento de boleto não é interpretado como inadimplência. Busca/filtros e paginação de 30 registros são executados no servidor.

## Contrato

Todas as operações usam `billing_rpc('documentation', action, payload)`:

- `options {}`: prestadores, empresas e `canManage`.
- `sources {search?,type?}`: até 40 referências recentes, pesquisáveis por serviço, cotação, pedido, fornecedor, equipamento ou OC.
- `list {search?,kind?,status?,providerId?,dateFrom?,dateTo?,page?,includePending?}`: documentos, totais e pendências paginadas. `includePending:false` evita calcular a central de pendências em seletores auxiliares.
- `context {type:'service'|'quotation'|'order',id}`: referência, documentos, exigências e orçamentos existentes acessíveis pelas permissões originais.
- `get {id}`: documento, arquivos, documentos filhos e histórico.
- `prepare-upload {documentId,fileName,contentType,size}`: reserva arquivo/path por ator. Enviar ao Storage com `upsert:false` antes de `save`.
- `save {id,expectedRevision,kind,title,documentNumber,issuedOn,dueOn,amount,providerId,companyId,parentId,notes,sources:[{type,id}],fileIds}`: valida vínculos, bytes/MIME registrados no Storage e revisão. Datas/valores vazios representam ausência. Identidade e propriedade não são aceitas do payload.
- `review {id,expectedRevision,status,note,replacementId}`: registra responsável e horário. Divergência/cancelamento/substituição exigem motivo; substituição exige documento ativo do mesmo tipo/fornecedor/empresa. Repetições idênticas da última operação são idempotentes; alterações concorrentes geram conflito.
- `expectation {source:{type,id},kind,required,dueOn,notes}`: registra ou dispensa uma exigência específica. Dispensa não remove arquivos.

## Acesso e arquivos

Permissões `documentation.read` e `documentation.write`, com escrita exigindo leitura. Os perfis padrão Administrador e Somente leitura são atualizados; perfis personalizados mantêm suas permissões até alteração explícita.

Tabelas `billing_documents`, `billing_document_links`, `billing_document_files`, `billing_document_events` e `billing_document_expectations` têm RLS por proprietário, SELECT autenticado para Realtime e nenhuma concessão de DML direto. FKs compostas impedem vínculos entre contas. Constraints diferidas preservam os vínculos ao fim da transação e permitem cascatas completas de uma conta Auth.

Bucket privado `billing-documentation`, com prefixo por proprietário, reserva por ator e URLs assinadas de cinco minutos. Upload sem sobrescrita; nenhuma política de UPDATE/DELETE de objetos para usuários finais. Conferência e cancelamento não apagam os arquivos.

TanStack Query usa `['billing',userId,'documentation',params]`. Mutations cancelam consultas e aguardam invalidação; Realtime centralizado invalida também projeções derivadas das origens. Formulários são desmontados por conta e operações assíncronas conferem o ator entre cada etapa.

## Verificação

`node tests/documentation-rpc.test.mjs` executa a cadeia real de migrations no PGlite e verifica origens, herança cotação/pedido, conferência, boletos opcionais, repetições, revisões, arquivos privados, escrita direta negada, leitores e isolamento. Também integra `npm test`.

`tests/documentation-supabase-live.mjs`, com `BILLING_RUN_LIVE_TESTS=1`, usa o CLI autenticado no projeto `ykounjabfsrtkzostbbz`, cria duas contas efêmeras e remove somente seus registros e arquivos. `BILLING_CDP_URL` habilita envio real pelo navegador, prévia, conferência, atualização Realtime independente, abas das origens e testes responsivos. Chaves administrativas permanecem somente na memória do processo.
