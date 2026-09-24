import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const hooks = {
  users: '../modules/configuracoes/usuarios/hooks/useUsers.ts',
  accessProfiles: '../modules/configuracoes/perfis-acesso/hooks/useAccessProfiles.ts',
  companies: '../modules/configuracoes/empresas/hooks/useCompanies.ts',
  watermark: '../modules/configuracoes/marca-dagua/hooks/useWatermark.ts',
  reportHeader: '../modules/configuracoes/cabecalho-relatorios/hooks/useReportHeader.ts',
};

test('configuration writes use the account-safe mutation lifecycle', async () => {
  const sources = Object.fromEntries(await Promise.all(
    Object.entries(hooks).map(async ([name, path]) => [name, await readFile(new URL(path, import.meta.url), 'utf8')]),
  ));

  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /useCadastroMutation/, `${name} must use the shared mutation lifecycle`);
    assert.doesNotMatch(source, /\buseMutation\b/, `${name} must not bypass account-safe invalidation`);
    assert.doesNotMatch(source, /setQueryData/, `${name} must not inject results after an account switch`);
  }

  assert.match(sources.users, /useCadastroMutation\('users',[\s\S]*?related\)/);
  assert.match(sources.users, /related=\['access-profiles','permissions'\]/);
  assert.match(sources.accessProfiles, /useCadastroMutation\('access-profiles',[\s\S]*?related\)/);
  assert.match(sources.accessProfiles, /related=\['users','permissions'\]/);
  assert.match(sources.companies, /useCadastroMutation\('companies',[\s\S]*?\['contracts','report-headers'\]\)/);
  assert.match(sources.watermark, /useCadastroMutation\('watermarks',[\s\S]*?\['watermark','report-headers'\]\)/);
  assert.match(sources.reportHeader, /useCadastroMutation\('report-headers',persistReportHeader\)/);
});

test('shared mutation lifecycle cancels, awaits invalidation and isolates the actor', async () => {
  const source = await readFile(
    new URL('../modules/cadastro/hooks/useCadastroQuery.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /onMutate:async\(\)=>[\s\S]*?await Promise\.all\([\s\S]*?cancelQueries/);
  assert.match(source, /return \{actorId\}/);
  assert.match(source, /activeUserIdRef\.current!==context\.actorId/);
  assert.match(source, /onSuccess:async[\s\S]*?await refresh\(context\.actorId\)/);
});
