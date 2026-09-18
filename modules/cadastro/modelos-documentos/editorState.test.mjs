import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./editorState.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
const {editorInitialState, editorReducer, documentWithInlineText, constrainDocumentBlock} = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));
const template = {key: 'service-request', name: 'Serviço', version: 0, layout: {page: {width: 210, height: 297}, blocks: [{id: 'title', type: 'text', x: 16, y: 24, width: 142, height: 12, text: 'Título anterior'}]}};

test('saving before contentEditable blur includes the visible draft and supports undo', () => {
  const initial = editorInitialState(template);
  const saveSnapshot = documentWithInlineText(initial.present, {id: 'title', text: 'Texto digitado antes de Ctrl+S'});
  assert.equal(saveSnapshot.layout.blocks[0].text, 'Texto digitado antes de Ctrl+S');
  assert.equal(initial.present.layout.blocks[0].text, 'Título anterior');
  const committed = editorReducer(initial, {type: 'change', document: saveSnapshot});
  assert.deepEqual(editorReducer(committed, {type: 'undo'}).present, initial.present);
  assert.deepEqual(editorReducer(editorReducer(committed, {type: 'undo'}), {type: 'redo'}).present, saveSnapshot);
});

test('a drag with many intermediate pointer positions creates one undo step', () => {
  const initial = editorInitialState(template);
  let state = initial;
  for (const x of [18, 20, 23, 28]) state = editorReducer(state, {type: 'preview', document: {...initial.present, layout: {...initial.present.layout, blocks: [{...initial.present.layout.blocks[0], x}]}}});
  assert.equal(state.past.length, 0);
  state = editorReducer(state, {type: 'gesture', before: initial.present});
  assert.equal(state.past.length, 1);
  assert.equal(state.present.layout.blocks[0].x, 28);
  assert.equal(editorReducer(state, {type: 'undo'}).present.layout.blocks[0].x, 16);
});

test('resizing and moving keep a block within the visible A4 page', () => {
  const bounded = constrainDocumentBlock({id: 'field', type: 'field', x: -10, y: 296, width: 220, height: 20});
  assert.equal(bounded.x, 0); assert.equal(bounded.width, 210);
  assert.equal(bounded.y, 277); assert.equal(bounded.height, 20);
  const line = constrainDocumentBlock({id: 'line', type: 'line', x: 16, y: 25, width: 178, height: -1});
  assert.equal(line.height, 0.2);
});
