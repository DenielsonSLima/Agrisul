import {useEffect,useRef,useState} from 'react';
import {Loader2,Save} from 'lucide-react';
import {Choice,Field} from '@/shared/components/Common';
import {CurrencyInput} from '@/shared/components/CurrencyInput';
import {notifications} from '@/shared/feedback';
import {atrMonths} from '../utils/atrGrouping';
import type {AtrInput,AtrRecord} from '../types';

export function AtrForm({record,year,month,onSave,onClose,onBusy}:{record?:AtrRecord;year?:number;month?:number;onSave:(data:AtrInput,id?:string)=>Promise<void>;onClose:()=>void;onBusy:(busy:boolean)=>void}){
  const [selectedMonth,setMonth]=useState(String(record?.month||month||new Date().getMonth()+1));
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  return <form onSubmit={async event=>{
    event.preventDefault();
    if(saving)return;
    setError('');
    const data=new FormData(event.currentTarget);
    try{
      const input:AtrInput={
        year:Number(data.get('year')),
        month:Number(selectedMonth),
        monthlyGrossValue:String(data.get('monthlyGrossValue')??''),
        monthlyNetValue:String(data.get('monthlyNetValue')??''),
        accumulatedGrossValue:String(data.get('accumulatedGrossValue')??''),
        accumulatedNetValue:String(data.get('accumulatedNetValue')??''),
      };
      setSaving(true);onBusy(true);
      await onSave(input,record?.id);
      if(mounted.current)onClose();
    }catch(error){
      const message=(error as Error).message;
      if(mounted.current){setError(message);notifications.error(message);}
    }finally{
      if(mounted.current){setSaving(false);onBusy(false);}
    }
  }}>
    <fieldset disabled={saving} className="company-fieldset">
      <div className="form-grid"><Field label="Ano"><input name="year" type="number" min={1900} max={9999} step={1} required defaultValue={record?.year||year||new Date().getFullYear()}/></Field><Field label="Mês"><Choice label="Mês de referência" value={selectedMonth} onChange={setMonth} items={atrMonths.map((label,index)=>({value:String(index+1),label}))}/></Field></div>
      <div className="atr-form-quotes">
        <section><h4>Cotação mensal</h4><div className="form-grid"><Field label="Bruta (R$/kg ATR)"><CurrencyInput name="monthlyGrossValue" maximumFractionDigits={6} required defaultValue={record?.monthlyGrossValue} placeholder="Ex.: R$ 1,3119" autoComplete="off"/></Field><Field label="Líquida após deduções (R$/kg ATR)"><CurrencyInput name="monthlyNetValue" maximumFractionDigits={6} required defaultValue={record?.monthlyNetValue} placeholder="Ex.: R$ 1,2922" autoComplete="off"/></Field></div></section>
        <section><h4>Cotação acumulada da safra</h4><div className="form-grid"><Field label="Bruta (R$/kg ATR)"><CurrencyInput name="accumulatedGrossValue" maximumFractionDigits={6} required defaultValue={record?.accumulatedGrossValue} placeholder="Ex.: R$ 1,1999" autoComplete="off"/></Field><Field label="Líquida após deduções (R$/kg ATR)"><CurrencyInput name="accumulatedNetValue" maximumFractionDigits={6} required defaultValue={record?.accumulatedNetValue} placeholder="Ex.: R$ 1,1819" autoComplete="off"/></Field></div></section>
      </div>
    </fieldset>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <div className="form-actions"><button type="button" className="btn" onClick={onClose} disabled={saving}>Cancelar</button><button className="btn company-primary" disabled={saving}>{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?'Salvando…':record?'Salvar alterações':'Cadastrar mês'}</button></div>
  </form>;
}
