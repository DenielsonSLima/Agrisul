import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../shared/access/permissionCatalog.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const {permissionGroups,permissionKeys,toggleProfilePermissions,profileAccessSummary}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));

test('employees and overtime can be granted without any sibling module',()=>{
  let permissions=toggleProfilePermissions(new Set(),['employees.write'],true);
  permissions=toggleProfilePermissions(permissions,['overtime.write'],true);
  assert.deepEqual([...permissions].sort(),['employees.read','employees.write','overtime.read','overtime.write']);
  assert.deepEqual(profileAccessSummary([...permissions]),['Cadastros / Funcionários','Solicitações / Relatório de hora extra']);
  assert.deepEqual([...toggleProfilePermissions(permissions,['employees.read'],false)].sort(),['overtime.read','overtime.write']);
});

test('selecting a module is an explicit collection of granular permissions',()=>{
  const requestModule=permissionGroups.find(group=>group.id==='requests');
  const keys=requestModule.submodules.flatMap(submodule=>submodule.options.map(option=>option.key));
  const selected=toggleProfilePermissions(new Set(),keys,true);
  assert.deepEqual([...selected].sort(),keys.sort());
  assert.ok(!selected.has('requests.read'));
  assert.ok(!selected.has('registrations.read'));
  assert.deepEqual([...toggleProfilePermissions(selected,keys,false)],[]);
});

test('configuration dependencies are removed together while independent templates remain',()=>{
  let permissions=toggleProfilePermissions(new Set(),['report-headers.write','document-templates.write'],true);
  assert.ok(permissions.has('companies.read'));
  assert.ok(permissions.has('watermarks.read'));
  assert.ok(permissions.has('report-headers.read'));
  permissions=toggleProfilePermissions(permissions,['watermarks.read'],false);
  assert.ok(!permissions.has('report-headers.read'));
  assert.ok(!permissions.has('report-headers.write'));
  assert.ok(permissions.has('document-templates.read'));
  assert.ok(permissions.has('document-templates.write'));
});

test('permission catalog has unique keys and no legacy broad grants',()=>{
  assert.equal(new Set(permissionKeys).size,permissionKeys.length);
  assert.ok(!permissionKeys.some(key=>key.startsWith('registrations.')||key.startsWith('requests.')));
  assert.ok(permissionKeys.includes('signatures.read'));
  const signatures=toggleProfilePermissions(new Set(),['signatures.manage'],true);
  assert.ok(signatures.has('signatures.read'));
  assert.equal(toggleProfilePermissions(signatures,['signatures.read'],false).size,0);
  assert.ok(!permissionKeys.includes('agenda.write'));
  assert.ok(!permissionKeys.includes('reports.write'));
});
