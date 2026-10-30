# TV Agro

A aba reúne Canal Rural, Notícias Agrícolas, TV Senado, AgroMais e Canal do Boi. Os IDs oficiais estão em `catalog.ts`. `/api/dashboard-tv` exige sessão verificada e consulta RSS e buscas públicas dos canais, sem chave YouTube. Seleciona até quatro vídeos por canal, somente das últimas 36 horas, e atualiza a cada cinco minutos. Título e descrição precisam tratar do agro; publicidade do próprio canal não torna um vídeo relevante.

A curadoria busca 50% cana-de-açúcar, 20% soja/milho e 30% outros temas agro, com seleção global por canal. As proporções dependem do conteúdo publicado. Vagas não são preenchidas com assuntos gerais ou vídeos antigos. Busca complementar tem orçamento total de 30 segundos, até três consultas por canal e três canais concorrentes. Datas relativas ambíguas são rejeitadas; até quatro candidatos de cana recebem consulta opcional da data exata. Cache de contingência também respeita as 36 horas.

Shorts são excluídos antes da seleção: uma consulta HEAD limitada ao endpoint público `/shorts/:id` distingue Shorts de vídeos regulares, sem seguir redirecionamentos externos. Resultados inconclusivos não entram na lista. A etapa usa oito consultas concorrentes, até 80 candidatos, cache limitado e orçamento de oito segundos. Na reprodução, as dimensões reais do formato também precisam ser horizontais (`width > height`); verticais, quadrados e dimensões desconhecidas não são anunciados no manifesto.

As configurações do Dashboard permitem selecionar canais e escolher:

- Reprodução automática: inicia o vídeo, respeitando a permissão de áudio do navegador. Ao terminar, a apresentação segue para a próxima aba; com apenas TV ativa, segue para o próximo vídeo. Publicações indisponíveis são puladas, até cinco tentativas.
- Prévia: exibe miniaturas; o player e o áudio só carregam ao clicar. Durante a apresentação, os destaques alternam a cada oito segundos.
- Só passar: exclui TV Agro da apresentação automática e mantém o acesso manual.

## Reprodução própria

O player usa `dashjs` e um elemento `<video>`, sem iframe YouTube nem chamadas ao sistema de anúncios. `youtubei.js` resolve somente vídeos dos cinco canais. A transformação das assinaturas acontece em QuickJS/WASM, com limite de três segundos e 32 MiB, sem acesso ao Node, arquivos ou rede dentro do interpretador.

A extração usa uma sessão anônima obtida do próprio YouTube e o cliente VISIONOS. Uma sessão fabricada localmente com os clientes anteriores conseguia iniciar o vídeo, mas o CDN recusava faixas de áudio posteriores ao primeiro MiB. Não há geração de prova no navegador, código remoto de verificação na página nem serviço adicional.

Os controles próprios incluem reprodução/pausa, posição, volume, tela cheia e resolução. O seletor oferece Auto e somente as qualidades que o manifesto disponibiliza; a seleção manual desativa a adaptação automática até selecionar Auto novamente. O botão Reprodução automática também salva a preferência do Dashboard. Lista e metadados seguem as superfícies claras do sistema; preto fica restrito ao vídeo.

`/api/dashboard-tv/playback?videoId=...` retorna um MPD com áudio AAC e até duas qualidades de vídeo H.264, limitadas a 720p. Antes de anunciar uma qualidade, o servidor lê o índice SIDX, um trecho a partir de 1,5 MB e os últimos bytes do arquivo, conferindo intervalos e tamanhos; uma variante indisponível não bloqueia as demais. Isso impede que o sucesso apenas no índice inicial seja tratado como garantia de reprodução. Os endereços de mídia apontam exclusivamente para `/api/dashboard-tv/stream?videoId=...&itag=...`. Cada solicitação usa o cabeçalho Authorization da sessão atual, incluindo as requisições de trechos e de índice do DASH. Não há tokens na URL e nenhum endereço arbitrário do cliente é usado como destino do proxy.

O servidor permite apenas HTTPS em hosts `*.googlevideo.com`, caminho `/videoplayback`, sem redirecionamentos. Exige um Range explícito e único de até 16 MiB; confere status 206, Content-Range, tipo e tamanho, e transmite o corpo com cancelamento e timeout. A resposta é privada e não fica em cache HTTP. O cache em memória é limitado, deduplica resoluções e não é necessário para a correção em instâncias serverless distintas.

Não há serviço externo, VPS, armazenamento de vídeos nem alteração de tabelas Supabase. O tráfego de mídia passa pela função da aplicação. Next e Nitro mantêm os pacotes do extrator externos e incluem o arquivo WASM no artefato.

Lives, estreias e alguns vídeos recém-encerrados ainda não oferecem os índices necessários e retornam indisponibilidade. Mudanças ou bloqueios do YouTube podem afetar a extração. Falhas exibem nova tentativa e um link explícito para abrir o vídeo no YouTube; o sistema não troca silenciosamente para um iframe com anúncios. Anúncios ou patrocínios que integrem a própria gravação permanecem no conteúdo.

## Verificação e pesquisa

Na investigação de 30/10/2026, a implementação anterior interrompia a reprodução por volta de 12 segundos quando o áudio além do primeiro MiB retornava HTTP 403. O caminho corrigido leu uma faixa inteira de 12.733.638 bytes em 13 intervalos, todos com status 206 e tamanhos corretos. No dashboard local, reproduziu mais de 100 segundos contínuos em 720p e continuou após avançar para aproximadamente 8min30s. A validação de hospedagem deve ser feita separadamente, pois o YouTube pode recusar requisições de servidores; sucesso local não comprova disponibilidade na Vercel. Diagnósticos temporários no Supabase foram removidos junto com as identidades de teste.

Os testes `tv.test.mjs`, `curation.test.mjs`, `videoFormat.test.mjs`, `query.test.mjs`, `playback.test.mjs`, `mediaRoutes.test.mjs` e `nativePlayer.test.mjs` fazem parte de `npm run test:dashboard`. Eles verificam curadoria, proporções possíveis, janela temporal, feed, isolamento da consulta, autenticação das rotas, origens, intervalos, disponibilidade após o primeiro MiB, limites, cancelamento e ciclo do player. Os testes de apresentação também cobrem migração das preferências, abas habilitadas, pausa durante configurações/vídeo e troca de conta.

A implementação foi orientada pelo código público de [YouTube.js](https://github.com/LuanRT/YouTube.js), [QuickJS Emscripten](https://github.com/justjake/quickjs-emscripten) e [dash.js](https://github.com/Dash-Industry-Forum/dash.js). Também foram analisados [Invidious](https://github.com/iv-org/invidious), [Invidious companion](https://github.com/iv-org/invidious-companion), [Piped](https://github.com/TeamPiped/Piped) e [yt-dlp](https://github.com/yt-dlp/yt-dlp). Invidious/Piped exigiriam serviços adicionais; o caminho implementado usa as rotas da própria aplicação.
