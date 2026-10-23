import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../modules/importacoes/utils/profileSelection.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {availableImportProfiles,preferredImportProfile}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const profile=(id,clientId=null,active=true,isDefault=false)=>({id,clientId,active,isDefault,fields:[{key:'CODE',type:'text'}],templateBase64:'original-bytes'});
test('new imports offer only active models compatible with their client',()=>{
 const all=[profile('global'),profile('for-one','one'),profile('for-two','two'),profile('inactive','one',false,true)];
 assert.deepEqual(availableImportProfiles(all,'one').map(item=>item.id),['global','for-one']);
 assert.deepEqual(availableImportProfiles(all,'two').map(item=>item.id),['global','for-two']);
 assert.deepEqual(availableImportProfiles(all).map(item=>item.id),['global','for-one','for-two']);
});
test('a client default wins over the general default, with safe fallbacks',()=>{
 const all=[profile('first','one'),profile('global',null,true,true),profile('client-default','one',true,true),profile('inactive-default','two',false,true)];
 assert.equal(preferredImportProfile(all,'one').id,'client-default');assert.equal(preferredImportProfile(all,'two').id,'global');assert.equal(preferredImportProfile(all).id,'global');
 assert.equal(preferredImportProfile([profile('inactive',null,false,true)]),undefined);
 assert.equal(preferredImportProfile([profile('other','one')],'two'),undefined);
});
test('selecting defaults retains the exact profile and never copies or reinfers its column types',()=>{
 const original=profile('default','one',true,true);const selected=preferredImportProfile([original],'one');
 assert.equal(selected,original);assert.equal(selected.fields,original.fields);assert.equal(selected.templateBase64,'original-bytes');assert.equal(selected.fields[0].type,'text');
});
