'use client';
import {useEffect,useLayoutEffect,useRef,useState,type RefCallback} from 'react';
import {durationCompletionDelay,durationCursor,durationDisplay,durationFromText,durationRawPosition,editDuration,type DurationEdit} from '../durationInput';

export function OvertimeDurationInput({value,onChange,label,onComplete,inputRef}:{value:string;onChange:(value:string)=>void;label:string;onComplete?:()=>void;inputRef?:RefCallback<HTMLInputElement>}){
 const [model,setModel]=useState(()=>({source:value,edit:durationFromText(value)??{digits:'',hourWidth:2}}));
 if(value!==model.source)setModel({source:value,edit:durationFromText(value)??{digits:'',hourWidth:2}});
 const input=useRef<HTMLInputElement|null>(null),cursor=useRef<number|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const explicitSeparator=useRef(false);
 const cancelAdvance=()=>{if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}};
 useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);},[]);
 useLayoutEffect(()=>{const node=input.current;if(node&&cursor.current!==null&&node===document.activeElement){node.setSelectionRange(cursor.current,cursor.current);cursor.current=null;}},[model]);
 const complete=()=>{const node=input.current;if(node&&node===document.activeElement&&!node.matches(':disabled'))onComplete?.();};
 const update=(edit:DurationEdit,position:number,advance=true)=>{
  cancelAdvance();const display=durationDisplay(edit);cursor.current=durationCursor(edit,position);
  setModel({source:display,edit});onChange(display);
  const delay=advance&&onComplete?durationCompletionDelay(edit):null;
  if(delay!==null)timer.current=setTimeout(complete,delay);
 };
 const replace=(start:number,end:number,text:string)=>{const result=editDuration(model.edit,start,end,text);if(result)update(result.edit,result.cursor);};
 const display=durationDisplay(model.edit);
 useEffect(()=>{if(value!==display&&durationFromText(value)!==null)onChange(display);},[value,display,onChange]);
 return <input ref={node=>{input.current=node;inputRef?.(node);}} type="text" inputMode="numeric" autoComplete="off" spellCheck={false} aria-label={label} placeholder="00:00:00" value={display}
  onFocus={event=>{cancelAdvance();explicitSeparator.current=false;event.currentTarget.select();}}
  onBlur={cancelAdvance}
  onKeyDown={event=>{
   if(event.ctrlKey||event.metaKey||event.altKey)return;
   const node=event.currentTarget,selectedAll=node.selectionStart===0&&node.selectionEnd===display.length;
   let start=durationRawPosition(model.edit,node.selectionStart??0),end=durationRawPosition(model.edit,node.selectionEnd??0);
   if(/^\d$/.test(event.key)){
    event.preventDefault();
    if(selectedAll){explicitSeparator.current=false;update({digits:event.key,hourWidth:2},1);}
    else replace(start,end,event.key);
   }else if(event.key==='Backspace'||event.key==='Delete'){
    event.preventDefault();cancelAdvance();
    if(start===end){if(event.key==='Backspace')start=Math.max(0,start-1);else end=Math.min(model.edit.digits.length,end+1);}
    const result=editDuration(model.edit,start,end,'');if(result)update(result.edit,result.cursor,false);
   }else if(event.key===':'){
    event.preventDefault();cancelAdvance();
    if(!explicitSeparator.current&&model.edit.digits.length){
     explicitSeparator.current=true;const width=Math.max(2,model.edit.digits.length);
     update({digits:model.edit.digits.padStart(width,'0'),hourWidth:width},width,false);
    }else if(explicitSeparator.current){cursor.current=model.edit.hourWidth+4;setModel(current=>({...current}));}
   }else if(event.key==='Enter'){
    event.preventDefault();cancelAdvance();complete();
   }else if(['ArrowLeft','ArrowRight','Home','End','Tab'].includes(event.key))cancelAdvance();
  }}
  onChange={event=>{
   // Virtual keyboards can dispatch input without a usable keydown event.
   const next=event.target.value;
   let start=0;while(start<display.length&&start<next.length&&display[start]===next[start])start++;
   let oldEnd=display.length,newEnd=next.length;
   while(oldEnd>start&&newEnd>start&&display[oldEnd-1]===next[newEnd-1]){oldEnd--;newEnd--;}
   const inserted=next.slice(start,newEnd);
   if(/^\d*$/.test(inserted)){
    let from=durationRawPosition(model.edit,start);const to=durationRawPosition(model.edit,oldEnd);
    if(!inserted&&from===to&&(event.nativeEvent as InputEvent).inputType==='deleteContentBackward')from=Math.max(0,from-1);
    replace(from,to,inserted);
   }
  }}
  onPaste={event=>{
   event.preventDefault();const pasted=durationFromText(event.clipboardData.getData('text'));if(!pasted)return;
   explicitSeparator.current=event.clipboardData.getData('text').includes(':');update(pasted,pasted.digits.length);
  }}/>
}
