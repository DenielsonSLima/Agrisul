import {useEffect,useRef,useState} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Choice,Field} from '@/shared/components/Common';
import {Textarea} from '@/components/ui/textarea';
import {notifications} from '@/shared/feedback';
import type {Culture} from '../../culturas/types';
import {managementCategories,type CulturalPractice,type ManagementCategory,type PracticeInput} from '../types';

type Props={
 practice?:CulturalPractice;
 cultures:Culture[];
 initialCultureId?:string;
 initialSubtypeId?:string;
 onSave:(data:PracticeInput,id?:string)=>Promise<void>;
 onClose:()=>void;
 onBusy:(busy:boolean)=>void;
};

export function PracticeForm({practice,cultures,initialCultureId,initialSubtypeId,onSave,onClose,onBusy}:Props){
 const [cultureId,setCultureId]=useState(practice?.cultureId??initialCultureId??'');
 const [subtypeId,setSubtypeId]=useState(practice?.cultureSubtypeId??initialSubtypeId??'');
 const [category,setCategory]=useState<ManagementCategory|''>(practice?.category??'');
 const [operation,setOperation]=useState(practice?.name??'');
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const subtypes=cultures.find(culture=>culture.id===cultureId)?.subtypes??[];
 const operations=managementCategories.find(item=>item.value===category)?.operations??[];
 const chooseCulture=(value:string)=>{setCultureId(value);setSubtypeId('');};
 const chooseCategory=(value:string)=>{setCategory(value as ManagementCategory);setOperation('');};
 return <form onSubmit={async event=>{
  event.preventDefault();if(saving)return;setError('');
  const form=new FormData(event.currentTarget);
  try{
   if(!cultureId||!subtypeId)throw new Error('Selecione a cultura e depois o ciclo.');
   if(!category||!operation)throw new Error('Selecione a categoria e a operação de manejo.');
   const input:PracticeInput={cultureId,cultureSubtypeId:subtypeId,category,name:operation,description:String(form.get('description')??'')};
   setSaving(true);onBusy(true);await onSave(input,practice?.id);if(mounted.current)onClose();
  }catch(caught){
   const message=(caught as Error).message;
   if(mounted.current){setError(message);notifications.error(message);}
  }finally{if(mounted.current){setSaving(false);onBusy(false);}}
 }}>
  <fieldset disabled={saving} className="company-fieldset">
   <div className="form-grid">
    <Field label="Cultura"><Choice label="Selecione a cultura" value={cultureId} onChange={chooseCulture} items={cultures.map(culture=>({value:culture.id,label:culture.name}))}/></Field>
    <Field label="Ciclo da cultura"><Choice label={cultureId?'Selecione planta, soca ou outro ciclo':'Selecione primeiro a cultura'} value={subtypeId} onChange={setSubtypeId} disabled={!cultureId} items={subtypes.map(subtype=>({value:subtype.id,label:subtype.name}))}/></Field>
   </div>
   <div className="form-grid">
    <Field label="Categoria"><Choice label="Selecione a categoria" value={category} onChange={chooseCategory} items={managementCategories.map(item=>({value:item.value,label:item.label}))}/></Field>
    <Field label="Operação"><Choice label={category?'Selecione a operação':'Selecione primeiro a categoria'} value={operation} onChange={setOperation} disabled={!category} items={operations.map(name=>({value:name,label:name}))}/></Field>
   </div>
   <Field label="Observações (opcional)"><Textarea name="description" defaultValue={practice?.description} maxLength={2000} placeholder="Registre detalhes e particularidades deste manejo." rows={4} className="practice-description-input"/></Field>
  </fieldset>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="form-actions"><button type="button" className="btn" disabled={saving} onClick={onClose}>Cancelar</button><button className="btn company-primary" disabled={saving}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?'Salvando…':practice?'Salvar alterações':'Adicionar operação'}</button></div>
 </form>;
}
