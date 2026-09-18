import type {DocumentBlock, DocumentLayout, DocumentTemplate} from './types';

export type EditorDocument = {name: string; layout: DocumentLayout};
export type EditorState = {past: EditorDocument[]; present: EditorDocument; future: EditorDocument[]};
export type InlineTextDraft = {id: string; text: string} | null;
export type EditorAction =
  | {type: 'change'; document: EditorDocument}
  | {type: 'preview'; document: EditorDocument}
  | {type: 'gesture'; before: EditorDocument}
  | {type: 'undo'}
  | {type: 'redo'};

export function editorInitialState(template: DocumentTemplate): EditorState {
  return {past: [], present: {name: template.name, layout: structuredClone(template.layout)}, future: []};
}

export function documentWithInlineText(document: EditorDocument, draft: InlineTextDraft): EditorDocument {
  if (!draft) return document;
  return {...document, layout: {...document.layout, blocks: document.layout.blocks.map(block => block.id === draft.id && block.type === 'text' ? {...block, text: draft.text.slice(0, 2000)} : block)}};
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    return previous ? {past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future]} : state;
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    return next ? {past: [...state.past, state.present].slice(-80), present: next, future: state.future.slice(1)} : state;
  }
  if (action.type === 'preview') return {...state, present: action.document};
  const before = action.type === 'gesture' ? action.before : state.present;
  const next = action.type === 'gesture' ? state.present : action.document;
  if (JSON.stringify(before) === JSON.stringify(next)) return state;
  return {past: [...state.past, before].slice(-80), present: next, future: []};
}

// These bounds concern only the editable page geometry. The RPC independently
// validates the persisted layout and protects its version against conflicts.
export function constrainDocumentBlock(block: DocumentBlock, bounds = {top: 0, bottom: 297}): DocumentBlock {
  const rounded = (value: number) => Math.round(value * 10) / 10;
  const width = rounded(Math.max(4, Math.min(210, block.width)));
  const height = rounded(Math.max(block.type === 'line' ? 0.2 : 4, Math.min(bounds.bottom - bounds.top, block.height)));
  return {...block, width, height, x: rounded(Math.max(0, Math.min(210 - width, block.x))), y: rounded(Math.max(bounds.top, Math.min(bounds.bottom - height, block.y)))};
}
