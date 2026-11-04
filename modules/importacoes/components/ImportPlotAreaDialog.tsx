'use client';
import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import type {ImportPlotAreaChoice,ImportPlotAreaSelection} from '../types';

type Selections=Record<string,ImportPlotAreaSelection>;
export function useImportPlotAreaChoice(){
 const [choices,setChoices]=useState<ImportPlotAreaChoice[]|null>(null);
 const pending=useRef<((value:Selections|null)=>void)|null>(null);
 useEffect(()=>()=>{pending.current?.(null);pending.current=null;},[]);
 function finish(value:Selections|null){const resolve=pending.current;pending.current=null;setChoices(null);resolve?.(value);}
 function choose(items:ImportPlotAreaChoice[]){
  pending.current?.(null);
  return new Promise<Selections|null>(resolve=>{pending.current=resolve;setChoices(items);});
 }
 return {choose,dialog:choices&&<PlotAreaDialog choices={choices} onChoose={finish}/>};
}

function PlotAreaDialog({choices,onChoose}:{choices:ImportPlotAreaChoice[];onChoose:(selections:Selections|null)=>void}){
 const [selected,setSelected]=useState<Selections>({});
 return <Dialog open onOpenChange={open=>{if(!open)onChoose(null);}}><DialogContent className="form-modal imports-plot-area-dialog">
  <DialogHeader><DialogTitle>Qual área deseja usar?</DialogTitle><DialogDescription>Encontramos mais de um cadastro para o talhão informado. Escolha a fazenda e a área correta para continuar.</DialogDescription></DialogHeader>
  <form onSubmit={event=>{event.preventDefault();if(choices.every(choice=>selected[choice.entryId]))onChoose(selected);}}>
   <div className="imports-plot-area-options">{choices.map((choice,index)=><fieldset key={choice.entryId}><legend>Talhão {choice.plotCode}{choice.farmCode?` · Fazenda ${choice.farmCode}`:''}{choices.length>1?` · Seleção ${index+1}`:''}</legend>
    {choice.candidates.map(candidate=><label key={candidate.plotId}><input type="radio" required name={`plot-${choice.entryId}`} value={candidate.plotId} checked={selected[choice.entryId]?.plotId===candidate.plotId} onChange={()=>setSelected(current=>({...current,[choice.entryId]:{plotId:candidate.plotId,updatedAt:candidate.updatedAt}}))}/><span>{candidate.farmCode} · {candidate.farmName}<small>Talhão {candidate.plotName} · {candidate.areaHa.replace('.',',')} ha</small></span></label>)}
   </fieldset>)}</div>
   <div className="imports-form-footer"><button type="button" className="btn" onClick={()=>onChoose(null)}>Cancelar</button><button type="submit" className="btn company-primary" disabled={!choices.every(choice=>selected[choice.entryId])}>Usar área selecionada</button></div>
  </form>
 </DialogContent></Dialog>;
}
