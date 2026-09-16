# Controle de Faturamento — executar localmente

## Iniciar

Com Node.js >=22.13.0, abra esta pasta no terminal:

```sh
npm run dev
```

Abra http://localhost:5173. As dependências já foram instaladas neste computador. Em uma cópia nova, use `pnpm install --frozen-lockfile` (pnpm 11.25.0).

## Conta e dados

Configurações, Cadastros e os contratos que usam esses cadastros estão ligados ao Supabase `rbuscpwntzpyqsuycqmv`. Entre com a conta do aplicativo; a senha do dashboard Supabase não é automaticamente uma conta do aplicativo. Você também pode criar uma conta na tela inicial e confirmar seu e-mail.

O `.env.local` deste computador contém somente a URL e a chave pública do projeto. Para outra instalação, copie `.env.example` para `.env.local` e preencha a chave pública. Nunca use token MCP, chave secreta ou service_role em variável VITE_.

Os dados são privados por usuário. Esta integração não importou dados do site antigo ou do D1. Não é necessário inicializar D1 para os módulos migrados.

## Regras e atualização

- Regras, vínculos, totais e saldos são calculados/validados na RPC PostgreSQL.
- TanStack Query mantém o cache por conta e invalida os módulos relacionados após salvar.
- Supabase Realtime dispara novas consultas quando os registros mudam; reconexão também revalida os dados.
- Marca d'água usa Storage privado e URLs temporárias.
- Consulta de CNPJ usa APIs públicas no servidor, cache de 15 minutos e alternativa quando o provedor principal está indisponível. Consulta não salva o cadastro automaticamente.
- O item Usuários permite editar o próprio perfil. Administração de outras contas não foi adicionada.

## Verificar alterações

```sh
npm test
npx tsc --noEmit
npm run build
```

O teste padrão usa PostgreSQL em memória e não altera o Supabase remoto. Testes antigos `*-api.test.mjs` de D1 são históricos; os endpoints atuais usam a RPC.

`npm run test:supabase:live` é um teste remoto explícito: cria duas contas temporárias, grava registros/uma imagem, verifica concorrência/Realtime/isolamento e remove apenas os dados que criou. Ele exige o MCP configurado no Antigravity e autorização para esses efeitos temporários.

As regras de desenvolvimento estão em `AGENTS.md` e na skill `controle-faturamento-supabase`, instalada no Codex e em `.agents/skills` do projeto. Mudanças locais não publicam automaticamente o site.
