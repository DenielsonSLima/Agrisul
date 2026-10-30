'use client';
import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import type {ImportField} from '../types';
import type {ImportCellMove} from '../utils/cellNavigation';
import {importFieldLabel,importValue} from '../utils/presentation';

type Draft={value:string;initial:string;revision:string;error:string};
type Props={entryId:string;field:ImportField;value:string;revision:string;rowNumber:number;blocked:boolean;saveUnchanged?:boolean;onSave:(value:string,revision:string)=>Promise<boolean>;onNavigate:(move:ImportCellMove)=>void};

export function ImportEditableCell({entryId,field,value,revision,rowNumber,blocked,saveUnchanged=false,onSave,onNavigate}:Props){
 blocked=blocked||field.key==='NUMERO_ANALISE';
 const [draft,setDraft]=useState<Draft|null>(null);const [saving,setSaving]=useState(false);
 const input=useRef<HTMLInputElement>(null);const button=useRef<HTMLButtonElement>(null);const locked=useRef(false);const suppressBlur=useRef(false);const selectOnFocus=useRef(true);const mounted=useRef(true);
 const editing=draft!==null;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(editing){input.current?.focus();if(selectOnFocus.current)input.current?.select();}},[editing]);
 function start(initial?:string){if(blocked||locked.current)return;suppressBlur.current=false;selectOnFocus.current=initial===undefined;setDraft({value:initial??value,initial:value,revision,error:''});}
 function cancel(){if(locked.current)return;suppressBlur.current=true;setDraft(null);requestAnimationFrame(()=>button.current?.focus());}
 async function commit(move?:ImportCellMove){
  if(!draft||locked.current||suppressBlur.current||blocked)return;
  locked.current=true;
  if(draft.value===draft.initial&&!saveUnchanged){setDraft(null);locked.current=false;if(move)onNavigate(move);return;}
  setSaving(true);
  try{
   const saved=await onSave(draft.value,draft.revision);
   if(saved){if(mounted.current)setDraft(null);if(move)onNavigate(move);}
   else if(mounted.current)input.current?.focus();
  }catch(reason){
   if(mounted.current){const message=reason instanceof Error?reason.message:'Não foi possível salvar esta célula.';setDraft(current=>current?{...current,error:message}:current);requestAnimationFrame(()=>input.current?.focus());}
  }finally{locked.current=false;if(mounted.current)setSaving(false);}
 }
 function keyDown(event:KeyboardEvent<HTMLInputElement>){
  if(event.nativeEvent.isComposing)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}
  else if(event.key==='Enter'||event.key==='Tab'){
   event.preventDefault();event.stopPropagation();void commit(event.key==='Enter'?(event.shiftKey?'up':'down'):(event.shiftKey?'previous':'next'));
  }
 }
 const label=`Linha ${rowNumber}, ${importFieldLabel(field)}`;
 return draft?<div className="imports-inline-cell" data-saving={saving} data-invalid={!!draft.error}>
  <input ref={input} data-import-cell data-entry-id={entryId} data-field-key={field.key} className="imports-cell-input" type={field.type==='date'?'date':'text'} inputMode={field.type==='decimal'?'decimal':undefined}
   aria-label={`Editar ${label}`} aria-invalid={!!draft.error} aria-describedby={draft.error?`cell-error-${entryId}-${field.key}`:undefined} title={draft.error||'Enter salva e desce · Tab avança · Esc cancela'}
   value={draft.value} readOnly={blocked||saving} maxLength={1000} onChange={event=>setDraft(current=>current?{...current,value:event.target.value,error:''}:current)} onKeyDown={keyDown} onBlur={()=>{if(!suppressBlur.current)void commit();}}/>
  {saving&&<span className="imports-inline-cell-status" role="status">Salvando…</span>}{draft.error&&<span id={`cell-error-${entryId}-${field.key}`} className="imports-inline-cell-error" role="alert">{draft.error}</span>}
 </div>:<button ref={button} type="button" data-import-cell data-entry-id={entryId} data-field-key={field.key} className="imports-cell-select" aria-label={`${label}: ${value||'vazio'}`} title={field.key==='NUMERO_ANALISE'?'Esta coluna permanece em branco.':'Clique para digitar · Enter salva e desce'} disabled={blocked} onClick={()=>start()} onKeyDown={event=>{
  if(event.key==='F2'){event.preventDefault();start();}
  else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key!==' '){event.preventDefault();start(event.key);}
 }}>{value?importValue(field,value):<span className={field.required?'imports-required':''}>—</span>}</button>;
}
