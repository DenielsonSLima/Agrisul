'use client';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Table2,X} from 'lucide-react';

/** Native modal stays in the top layer, including when the Dashboard is fullscreen. */
export function DashboardDataDialog({title,description,children}:{title:string;description:string;children:ReactNode}){
 const [open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null),id=useId();
 useEffect(()=>{
  const element=dialog.current;
  if(!element)return;
  if(open)element.showModal();else if(element.open)element.close();
  return()=>{if(element.open)element.close();};
 },[open]);
 return <>
  <button type="button" className="dashboard-data-trigger" aria-haspopup="dialog" onClick={()=>setOpen(true)}><Table2 size={14}/>Ver dados<span className="sr-only">: {title}</span></button>
  <dialog ref={dialog} className="dashboard-data-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event=>{event.preventDefault();setOpen(false);}} onClose={()=>setOpen(false)}>
   {open&&<><header><h3 id={`${id}-title`}>{title}</h3><button type="button" autoFocus aria-label="Fechar dados" onClick={()=>setOpen(false)}><X size={18}/></button></header><p id={`${id}-description`}>{description}</p><div className="dashboard-data-scroll" tabIndex={0} role="region" aria-label={title}>{children}</div></>}
  </dialog>
 </>;
}
