# Referências de mercado

A barra usa publicações externas e preserva a praça, a unidade e a data de cada fonte:

- Dólar e euro: AwesomeAPI pública, com cache de um minuto; Frankfurter é a alternativa diária quando a consulta intradiária falha.
- Soja, milho, boi, trigo, arroz, feijão, suíno e frango: planilha de preços diários da Epagri/Cepa. As praças selecionadas ficam em Santa Catarina e constam no catálogo.
- Cana: projeção da cana básica no campo publicada pelo Consecana-PR/Sistema FAEP.

O movimento visual da barra não altera a frequência das publicações. As fontes e os horários podem ser consultados no painel de informações; valores e percentuais ausentes não são estimados.

## Consultas e cache

O frontend consulta `/api/dashboard-market?group=currency`, `?group=agriculture` e `?group=cane` de forma independente. A rota valida a sessão antes do grupo. Uma consulta cambial não inicia nem aguarda o download da planilha agrícola.

TanStack Query mantém chaves `['billing', userId, 'dashboard-market', {group}]`. Câmbio é reconsultado a cada 60 segundos e os demais grupos a cada 600 segundos enquanto a tela está ativa. Cada provedor também mantém cache em memória e deduplica solicitações concorrentes no servidor.

A última resposta válida é guardada no navegador por usuário e grupo. Ela inicializa o cache da próxima visita como desatualizada, sem alterar preços, datas ou horários, e uma nova consulta começa imediatamente. Respostas inválidas, indisponíveis ou anteriores não apagam a última publicação válida. O armazenamento local é opcional; sua ausência não impede a consulta.

O parâmetro de grupo é opcional para compatibilidade com consumidores antigos. A resposta sem grupo aguarda os três provedores; a barra usa exclusivamente as consultas separadas.

## Verificação

`npm run test:dashboard` inclui os testes de provedores, validação da rota, persistência, consultas independentes e movimento. TypeScript e build também devem passar após mudanças de integração.
