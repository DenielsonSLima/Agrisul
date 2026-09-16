'use client';
import {TriangleAlert} from 'lucide-react';
import {
 AlertDialog,AlertDialogContent,AlertDialogDescription,
 AlertDialogFooter,AlertDialogHeader,AlertDialogMedia,AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import type {ConfirmationOptions} from './models';

export function ConfirmationDialog({options,onDecision}:{options:ConfirmationOptions;onDecision:(confirmed:boolean)=>void}){
 return <AlertDialog open onOpenChange={open=>{if(!open)onDecision(false);}}>
  <AlertDialogContent>
   <AlertDialogHeader>
    <AlertDialogMedia><TriangleAlert aria-hidden="true"/></AlertDialogMedia>
    <AlertDialogTitle>{options.title}</AlertDialogTitle>
    <AlertDialogDescription>{options.description}</AlertDialogDescription>
   </AlertDialogHeader>
   <AlertDialogFooter>
    <Button type="button" variant="outline" onClick={()=>onDecision(false)}>{options.cancelLabel??'Cancelar'}</Button>
    <Button type="button" variant={options.tone==='destructive'?'destructive':'default'} onClick={()=>onDecision(true)}>{options.confirmLabel??'Confirmar'}</Button>
   </AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
