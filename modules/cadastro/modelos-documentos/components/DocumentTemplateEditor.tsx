'use client';
import {useEffect, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent} from 'react';
import {AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowUp, Bold, Copy, GripVertical, Layers, Loader2, Minus, Move, Plus, QrCode, Redo2, RotateCcw, Save, Signature, Table2, Trash2, Type, Undo2, ZoomIn} from 'lucide-react';
import {notifications, useConfirmation} from '@/shared/feedback';
import {useDocumentWatermark} from '@/shared/reporting/useDocumentWatermark';
import {defaultServiceRequestLayout, documentExampleData} from '../defaultLayout';
import {constrainDocumentBlock, documentWithInlineText, editorInitialState, editorReducer, type EditorDocument, type InlineTextDraft} from '../editorState';
import {documentBlockLabel} from '../presentation';
import {documentBlockLabels, documentFieldLabels, type DocumentBlock, type DocumentBlockType, type DocumentField, type DocumentFont, type DocumentTemplate, type DocumentTemplateInput} from '../types';
import {DocumentLayoutPreview, documentBlockStyle} from './DocumentLayoutPreview';
import {useRequestDocumentBrand} from '@/modules/solicitacoes/hooks/useRequestDocumentBrand';
import {DOCUMENT_BODY_TOP, DOCUMENT_BODY_BOTTOM, layoutWithReportHeader} from '../reportHeaderLayout';

type Props = {
  template: DocumentTemplate; canManage: boolean; saving: boolean;
  onSave: (input: DocumentTemplateInput) => Promise<DocumentTemplate>;
  onBack: () => void; onReload: () => Promise<void>;
};
type Gesture = {pointerId: number; mode: 'move' | 'resize'; startX: number; startY: number; block: DocumentBlock; before: EditorDocument};
const fontOptions: {value: DocumentFont; label: string}[] = [{value: 'sans', label: 'Arial'}, {value: 'serif', label: 'Times New Roman'}, {value: 'mono', label: 'Courier New'}];
const initialDocument = (template: DocumentTemplate) => editorInitialState({...template, layout: layoutWithReportHeader(template.layout)});
const constrainBodyBlock = (block: DocumentBlock) => constrainDocumentBlock(block, {top: DOCUMENT_BODY_TOP, bottom: DOCUMENT_BODY_BOTTOM});

export function DocumentTemplateEditor({template, canManage, saving, onSave, onBack, onReload}: Props) {
  const branding = useDocumentWatermark();
  const reportBrand = useRequestDocumentBrand();
  const [history, dispatch] = useReducer(editorReducer, template, initialDocument);
  const [baseVersion, setBaseVersion] = useState(template.version);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialDocument(template).present));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inlineDirty, setInlineDirty] = useState(false);
  const [zoom, setZoom] = useState(75);
  const [error, setError] = useState('');
  const [overflow, setOverflow] = useState<string[]>([]);
  const gesture = useRef<Gesture | null>(null);
  const inlineDraft = useRef<InlineTextDraft>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const confirm = useConfirmation();
  const document = history.present;
  const selected = document.layout.blocks.find(block => block.id === selectedId);
  const dirty = JSON.stringify(document) !== baseline || inlineDirty;
  const scale = 3.2 * zoom / 100;
  const readOnly = !canManage || saving;
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const change = (next: EditorDocument) => {if (!readOnly) dispatch({type: 'change', document: next});};
  const patch = (id: string, value: Partial<DocumentBlock>) => change({...document, layout: {...document.layout, blocks: document.layout.blocks.map(block => block.id === id ? constrainBodyBlock({...block, ...value}) : block)}});
  const add = (type: DocumentBlockType) => {
    if (readOnly || document.layout.blocks.length >= 40) return;
    const offset = document.layout.blocks.length % 6 * 5;
    const sizes = {text: [95, 20], field: [90, 12], items: [178, 65], signature: [82, 41], verification: [178, 24], line: [178, 0.4]} as const;
    const block: DocumentBlock = {id: 'block-' + crypto.randomUUID(), type, x: 16, y: DOCUMENT_BODY_TOP + offset, width: sizes[type][0], height: sizes[type][1], fontSize: 10, fontFamily: 'sans', fontWeight: 'normal', align: 'left',
      ...(type === 'text' ? {text: 'Digite o texto aqui'} : type === 'field' ? {field: 'requesterName' as const} : type === 'signature' ? {field: 'requester' as const, align: 'center' as const} : {})};
    change({...document, layout: {...document.layout, blocks: [...document.layout.blocks, block]}}); setSelectedId(block.id); setEditingId(null);
  };
  const remove = async () => {
    if (!selected || readOnly) return;
    const id = selected.id;
    if (!await confirm({title: 'Excluir este bloco do modelo?', description: `“${documentBlockLabel(selected)}” será retirado deste modelo. Você poderá desfazer a alteração antes de sair do editor.`, confirmLabel: 'Excluir bloco', tone: 'destructive'}) || !mounted.current) return;
    change({...document, layout: {...document.layout, blocks: document.layout.blocks.filter(block => block.id !== id)}}); setSelectedId(null); setEditingId(null);
  };
  const duplicate = () => {
    if (!selected || readOnly || document.layout.blocks.length >= 40) return;
    const block = constrainBodyBlock({...selected, id: 'block-' + crypto.randomUUID(), x: selected.x + 4, y: selected.y + 4});
    change({...document, layout: {...document.layout, blocks: [...document.layout.blocks, block]}}); setSelectedId(block.id);
  };
  const reorder = (direction: -1 | 1) => {
    if (!selected || readOnly) return;
    const blocks = [...document.layout.blocks], index = blocks.findIndex(block => block.id === selected.id), next = index + direction;
    if (next < 0 || next >= blocks.length) return;
    [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
    change({...document, layout: {...document.layout, blocks}});
  };
  const leave = async () => {
    if (saving) return;
    if (!dirty || await confirm({title: 'Sair sem salvar o modelo?', description: 'As alterações desta edição serão descartadas. O modelo salvo continuará disponível.', confirmLabel: 'Sair sem salvar', tone: 'destructive'})) if (mounted.current) onBack();
  };
  const reload = async () => {
    if (saving) return;
    if (!dirty || await confirm({title: 'Reabrir a versão salva?', description: 'As alterações desta edição serão substituídas pela versão mais recente do modelo.', confirmLabel: 'Reabrir versão salva', tone: 'destructive'})) if (mounted.current) await onReload();
  };
  const restore = async () => {
    if (readOnly) return;
    if (!await confirm({title: 'Restaurar o modelo inicial?', description: 'Os blocos desta edição serão substituídos pelo modelo inicial. A mudança só será aplicada a novos documentos depois de salvar.', confirmLabel: 'Restaurar modelo'}) || !mounted.current) return;
    change({...document, layout: layoutWithReportHeader(structuredClone(defaultServiceRequestLayout))}); setSelectedId(null);
  };
  const save = async () => {
    const snapshot = documentWithInlineText(document, inlineDraft.current);
    if (busy.current || readOnly || JSON.stringify(snapshot) === baseline) return;
    // Ctrl+S does not blur contentEditable. Flush its current text before the RPC
    // so the persisted document is exactly what the operator sees on the page.
    if (inlineDraft.current) dispatch({type: 'change', document: snapshot});
    inlineDraft.current = null; setInlineDirty(false); setEditingId(null);
    busy.current = true; setError('');
    try {
      const saved = await onSave({key: template.key, name: snapshot.name, layout: snapshot.layout, expectedVersion: baseVersion});
      if (mounted.current) {
        const next = {name: saved.name, layout: saved.layout};
        dispatch({type: 'change', document: next}); setBaseline(JSON.stringify(next)); setBaseVersion(saved.version);
        notifications.saved(`Modelo salvo na versão ${saved.version}. As novas solicitações usarão este layout.`);
      }
    } catch (caught) {if (mounted.current) {const message = (caught as Error).message; setError(message); notifications.error(message);}}
    finally {busy.current = false;}
  };
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    const editable = event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {event.preventDefault(); void save(); return;}
    if (editable || readOnly) return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); dispatch({type: event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo'}); return;
    }
    if (!selected) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {event.preventDefault(); void remove();}
    const step = event.shiftKey ? 5 : 0.5;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); patch(selected.id, {x: selected.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: selected.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)});
    }
  };
  const startGesture = (event: PointerEvent<HTMLDivElement>, block: DocumentBlock) => {
    if (event.button !== 0 || editingId === block.id) return;
    setSelectedId(block.id); setEditingId(null);
    if (readOnly) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {pointerId: event.pointerId, mode: (event.target as HTMLElement).closest('[data-resize]') ? 'resize' : 'move', startX: event.clientX, startY: event.clientY, block, before: document};
  };
  const moveGesture = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId || readOnly) return;
    const dx = (event.clientX - current.startX) / scale, dy = (event.clientY - current.startY) / scale;
    const next = constrainBodyBlock({...current.block, ...(current.mode === 'move' ? {x: current.block.x + dx, y: current.block.y + dy} : {width: Math.min(210 - current.block.x, current.block.width + dx), height: Math.min(DOCUMENT_BODY_BOTTOM - current.block.y, current.block.height + dy)})});
    dispatch({type: 'preview', document: {...current.before, layout: {...current.before.layout, blocks: current.before.layout.blocks.map(block => block.id === next.id ? next : block)}}});
  };
  const finishGesture = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (cancel) dispatch({type: 'preview', document: current.before}); else dispatch({type: 'gesture', before: current.before});
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <section className="template-editor" onKeyDown={keyboard}>
    <div className="template-editor-heading"><div><button className="template-back" type="button" onClick={() => void leave()} disabled={saving}><ArrowLeft size={15}/>Modelos de documentos</button><h2>{document.name || 'Modelo sem nome'}</h2><p>Solicitações / Serviço · A4 retrato · {baseVersion ? `Versão ${baseVersion}` : 'Modelo inicial'}{dirty ? ' · Alterações não salvas' : ''}</p></div><div><button className="btn" type="button" onClick={() => void reload()} disabled={saving}><RotateCcw size={15}/>Reabrir versão salva</button>{canManage && <button className="btn company-primary" type="button" onClick={() => void save()} disabled={saving || !dirty}>{saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>}Salvar modelo</button>}</div></div>
    {!canManage && <p className="template-notice">Seu acesso permite consultar este modelo. A edição é liberada pela permissão de editar cabeçalhos e modelos de documentos.</p>}
    {template.version > baseVersion && <p className="template-notice">Existe uma versão mais recente salva por outra pessoa. Reabra a versão salva antes de continuar.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="template-notice">O cabeçalho usa a empresa e o modelo definidos em Configurações → Cabeçalho de relatórios.</p>
    {reportBrand.isPending && <p className="template-notice" role="status">Carregando cabeçalho configurado…</p>}
    {reportBrand.error && <p className="template-notice" role="alert">{reportBrand.error.message} <button type="button" className="btn small" onClick={() => void reportBrand.refetch()}>Tentar novamente</button></p>}
    {branding.loading && <p className="template-notice" role="status">Carregando marca d’água configurada…</p>}
    {branding.error && <p className="template-notice" role="alert">Não foi possível carregar a marca d’água. {branding.error} <button type="button" className="btn small" onClick={() => void branding.reload()}>Tentar novamente</button></p>}
    <div className="template-toolbar" aria-label="Ferramentas do editor">
      <div className="template-toolbar-group"><button title="Desfazer (Ctrl+Z)" aria-label="Desfazer" onClick={() => dispatch({type: 'undo'})} disabled={readOnly || !history.past.length}><Undo2 size={17}/></button><button title="Refazer (Ctrl+Y)" aria-label="Refazer" onClick={() => dispatch({type: 'redo'})} disabled={readOnly || !history.future.length}><Redo2 size={17}/></button></div>
      <div className="template-toolbar-group template-insert-tools">{([{type: 'text', label: 'Texto', icon: Type}, {type: 'field', label: 'Campo', icon: Plus}, {type: 'items', label: 'Serviços', icon: Table2}, {type: 'signature', label: 'Assinatura', icon: Signature}, {type: 'verification', label: 'QR / hash', icon: QrCode}, {type: 'line', label: 'Linha', icon: Minus}] as const).map(item => <button key={item.type} onClick={() => add(item.type)} disabled={readOnly || document.layout.blocks.length >= 40} title={`Adicionar ${item.label.toLowerCase()}`}><item.icon size={16}/><span>{item.label}</span></button>)}</div>
      <label className="template-zoom"><ZoomIn size={15}/><select value={zoom} onChange={event => setZoom(Number(event.target.value))} aria-label="Zoom da página">{[40, 50, 65, 75, 100, 125].map(value => <option value={value} key={value}>{value}%</option>)}</select></label>
    </div>
    <div className="template-editor-workspace">
      <aside className="template-layer-panel"><h3><Layers size={16}/>Blocos <span>{document.layout.blocks.length}/40</span></h3><p>Selecione um bloco ou arraste-o na página.</p><div className="template-layer-list">{[...document.layout.blocks].reverse().map(block => <button key={block.id} type="button" className={selectedId === block.id ? 'selected' : ''} onClick={() => {setSelectedId(block.id); setEditingId(null);}}><GripVertical size={13}/><span>{documentBlockLabel(block)}<small>{documentBlockLabels[block.type]}</small></span></button>)}</div>{canManage && <button className="template-reset" type="button" onClick={() => void restore()} disabled={saving}>Restaurar modelo inicial</button>}</aside>
      <div className="template-canvas-column"><div className="template-canvas-hint"><Move size={14}/><span>Arraste para mover · Use o canto para redimensionar · Duplo clique para editar texto</span></div><div className="template-canvas-scroll"><div className="template-canvas-stage"><div className="template-page-ruler" style={{width: 210 * scale}}><span>0</span><span>50</span><span>100</span><span>150</span><span>210 mm</span></div>
        <DocumentLayoutPreview layout={document.layout} data={documentExampleData} scale={scale} onOverflow={setOverflow} watermark={branding.watermark} brand={reportBrand.data}>
          {document.layout.blocks.map(block => <div key={block.id} data-template-block={block.id} role="button" tabIndex={0} aria-label={`Selecionar ${documentBlockLabel(block)}`} aria-pressed={selectedId === block.id} className={`template-block-overlay${selectedId === block.id ? ' selected' : ''}${editingId === block.id ? ' editing' : ''}${readOnly ? ' readonly' : ''}`} style={documentBlockStyle(block, scale)} onPointerDown={event => startGesture(event, block)} onPointerMove={moveGesture} onPointerUp={event => finishGesture(event)} onPointerCancel={event => finishGesture(event, true)} onFocus={() => setSelectedId(block.id)} onDoubleClick={() => {if (!readOnly && block.type === 'text') {setSelectedId(block.id); setEditingId(block.id);}}}>
            {editingId === block.id ? <div className="template-inline-text" contentEditable={!readOnly} suppressContentEditableWarning ref={element => {if (element) element.focus();}} onPointerDown={event => event.stopPropagation()} onInput={event => {const text = event.currentTarget.innerText || ''; inlineDraft.current = {id: block.id, text}; setInlineDirty(text !== (block.text ?? ''));}} onBlur={event => {patch(block.id, {text: (event.currentTarget.innerText || '').slice(0, 2000)}); inlineDraft.current = null; setInlineDirty(false); setEditingId(null);}} onKeyDown={event => {if (event.key === 'Escape') event.currentTarget.blur();}}>{block.text}</div> : selectedId === block.id && <><span className="template-block-caption">{documentBlockLabels[block.type]}</span>{!readOnly && <span data-resize className="template-resize-handle" title="Redimensionar bloco"/>}</>}
          </div>)}
        </DocumentLayoutPreview>
      </div></div><div className="template-canvas-footer"><span>Prévia com dados de exemplo · Nenhuma solicitação é alterada</span>{overflow.length > 0 && <p role="status">{overflow.length} bloco{overflow.length > 1 ? 's' : ''} com conteúdo maior que a caixa. Aumente a área ou reduza a fonte. No PDF, os excedentes seguem em páginas de continuação.</p>}</div></div>
      <aside className="template-properties"><h3>Propriedades</h3><label>Nome do modelo<input value={document.name} maxLength={120} minLength={2} disabled={readOnly} onChange={event => change({...document, name: event.target.value})}/></label>
        {!selected ? <div className="template-properties-empty"><Move size={26}/><p>Selecione um bloco para editar o conteúdo, a posição e a aparência.</p></div> : <><div className="template-selected-label">{documentBlockLabels[selected.type]}</div>
          {selected.type === 'text' && <label>Conteúdo<textarea rows={5} maxLength={2000} value={selected.text ?? ''} disabled={readOnly} onChange={event => patch(selected.id, {text: event.target.value})}/></label>}
          {selected.type === 'field' && <label>Campo do documento<select value={selected.field} disabled={readOnly} onChange={event => patch(selected.id, {field: event.target.value as DocumentField})}>{Object.entries(documentFieldLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {selected.type === 'signature' && <><label>Responsável<select value={selected.field} disabled={readOnly} onChange={event => patch(selected.id, {field: event.target.value as 'requester' | 'director'})}><option value="requester">Solicitante</option><option value="director">Diretor geral</option></select></label><p className="template-property-help">Com PNG, mostra a imagem e o hash do registro. Sem PNG, deixa a linha para assinatura manual.</p></>}
          {selected.type === 'verification' && <p className="template-property-help">O documento preenchido mostra o QR e o hash para conferir o registro no sistema. Reserve pelo menos 24 mm de altura para a leitura do QR.</p>}
          {selected.type !== 'line' && <><label>Fonte<select value={selected.fontFamily ?? 'sans'} disabled={readOnly} onChange={event => patch(selected.id, {fontFamily: event.target.value as DocumentFont})}>{fontOptions.map(font => <option value={font.value} key={font.value}>{font.label}</option>)}</select></label><div className="template-font-controls"><label>Tamanho (pt)<input type="number" min={8} max={28} value={selected.fontSize ?? 10} disabled={readOnly} onChange={event => {if (event.target.value) patch(selected.id, {fontSize: Math.max(8, Math.min(28, Number(event.target.value)))});}}/></label><button className={selected.fontWeight === 'bold' ? 'active' : ''} type="button" aria-label="Negrito" aria-pressed={selected.fontWeight === 'bold'} disabled={readOnly} onClick={() => patch(selected.id, {fontWeight: selected.fontWeight === 'bold' ? 'normal' : 'bold'})}><Bold size={17}/></button></div><div className="template-alignment" aria-label="Alinhamento">{([{value: 'left', label: 'Alinhar à esquerda', icon: AlignLeft}, {value: 'center', label: 'Centralizar', icon: AlignCenter}, {value: 'right', label: 'Alinhar à direita', icon: AlignRight}] as const).map(align => <button key={align.value} aria-label={align.label} aria-pressed={(selected.align ?? 'left') === align.value} className={(selected.align ?? 'left') === align.value ? 'active' : ''} disabled={readOnly} onClick={() => patch(selected.id, {align: align.value})}><align.icon size={17}/></button>)}</div></>}
          <h4>Posição e tamanho (mm)</h4><div className="template-geometry">{([{key: 'x', label: 'Esquerda'}, {key: 'y', label: 'Topo'}, {key: 'width', label: 'Largura'}, {key: 'height', label: 'Altura'}] as const).map(field => <label key={field.key}>{field.label}<input type="number" step={0.1} min={field.key === 'x' || field.key === 'y' ? 0 : 0.2} max={field.key === 'x' || field.key === 'width' ? 210 : 297} value={selected[field.key]} disabled={readOnly} onChange={event => {if (event.target.value) patch(selected.id, {[field.key]: Number(event.target.value)});}}/></label>)}</div>
          <h4>Organizar camadas</h4><div className="template-property-actions"><button title="Avançar uma camada" disabled={readOnly || document.layout.blocks.at(-1)?.id === selected.id} onClick={() => reorder(1)}><ArrowUp size={15}/>Avançar</button><button title="Recuar uma camada" disabled={readOnly || document.layout.blocks[0]?.id === selected.id} onClick={() => reorder(-1)}><ArrowDown size={15}/>Recuar</button><button disabled={readOnly || document.layout.blocks.length >= 40} onClick={duplicate}><Copy size={15}/>Duplicar</button><button className="destructive" disabled={readOnly} onClick={() => void remove()}><Trash2 size={15}/>Excluir</button></div>
        </>}
      </aside>
    </div>
  </section>;
}
