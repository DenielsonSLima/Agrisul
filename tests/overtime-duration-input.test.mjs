import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../modules/solicitacoes/horas-extras/durationInput.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const {durationDisplay,durationFromText,durationRawPosition,durationCursor,editDuration,durationCompletionDelay}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));

test('overtime digits fill hours then minutes then seconds without cents-style shifting',()=>{
 let edit={digits:'',hourWidth:2};
 const expected=['05:00:00','50:00:00','50:20:00','50:22:00','50:22:30','50:22:35'];
 for(const [index,digit] of [...'502235'].entries()){
  edit=editDuration(edit,edit.digits.length,edit.digits.length,digit).edit;
  assert.equal(durationDisplay(edit),expected[index]);
  assert.equal(durationRawPosition(edit,durationCursor(edit,edit.digits.length)),edit.digits.length);
 }
 assert.equal(durationCompletionDelay({digits:'5022',hourWidth:2}),650);
 assert.equal(durationCompletionDelay(edit),0);
 assert.equal(durationCompletionDelay({digits:'50',hourWidth:2}),null);
 assert.equal(durationCompletionDelay({digits:'5062',hourWidth:2}),null);
 assert.equal(durationCompletionDelay({digits:'502299',hourWidth:2}),null);
});
test('paste, selection replacement, clearing and large existing hours preserve duration meaning',()=>{
 for(const [raw,formatted] of [['50','50:00:00'],['5022','50:22:00'],['502235','50:22:35'],['150:22:05','150:22:05'],['8:30','08:30:00'],['8:3:5','08:03:05'],['','']])assert.equal(durationDisplay(durationFromText(raw)),formatted);
 const edit=durationFromText('50:22:35');
 assert.equal(durationDisplay(editDuration(edit,2,4,'30').edit),'50:30:35');
 assert.equal(durationDisplay(editDuration(edit,0,6,'').edit),'');
 assert.equal(editDuration(edit,6,6,'9'),null);
 for(const invalid of ['1.5','abc','-50','50::00'])assert.equal(durationFromText(invalid),null);
});
