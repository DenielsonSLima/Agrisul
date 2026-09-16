import {useState,type FormEvent} from 'react';
import {Loader2,Plus,Save,X} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import {CurrencyInput} from '@/shared/components/CurrencyInput';
import type {ContractDiscountInput,ContractPaymentInput} from '../../types';
import {formatContractMonth} from '../../utils/contractFormat';

export const financeToday=()=>{const date=new Date();return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');};
export type FinanceDraft=({type:'payment';input:ContractPaymentInput}|{type:'discount';input:ContractDiscountInput})&{id?:string;revision?:number};

export function ContractFinanceDialog({draft,knownMonths,busy,error,onSave,onClose,onRestoreFocus}:{draft:FinanceDraft;knownMonths:string[];busy:boolean;error:string;onSave:(draft:FinanceDraft)=>Promise<void>;onClose:()=>void;onRestoreFocus:()=>void}){
 const [value,setValue]=useState(draft),[monthToAdd,setMonthToAdd]=useState(''),[monthError,setMonthError]=useState('');
 const label=value.type==='discount'?'desconto':value.input.kind==='advance'?'adiantamento':'recebimento';
 const months=value.type==='discount'?value.input.months:[];
 const toggleMonth=(month:string)=>setValue(current=>current.type==='discount'?{...current,input:{...current.input,months:current.input.months.includes(month)?current.input.months.filter(item=>item!==month):[...current.input.months,month].sort()}}:current);
 const setPayment=(key:keyof ContractPaymentInput,text:string)=>setValue(current=>current.type==='payment'?{...current,input:{...current.input,[key]:text}}:current);
 const setDiscount=(key:'title'|'ratePerTon'|'notes',text:string)=>setValue(current=>current.type==='discount'?{...current,input:{...current.input,[key]:text}}:current);
 const submit=(event:FormEvent)=>{event.preventDefault();if(busy)return;if(value.type==='discount'&&!value.input.months.length){setMonthError('Selecione pelo menos um mês para aplicar o desconto.');return;}setMonthError('');void onSave(value);};
 const addMonth=()=>{if(!monthToAdd)return;if(!months.includes(monthToAdd))toggleMonth(monthToAdd);setMonthToAdd('');setMonthError('');};
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="form-modal finance-dialog" showCloseButton={!busy} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>event.preventDefault()} onCloseAutoFocus={event=>{event.preventDefault();onRestoreFocus();}}>
  <DialogHeader><DialogTitle>{value.id?'Editar':'Lançar'} {label}</DialogTitle><DialogDescription>{value.type==='discount'?'O valor por tonelada será aplicado a todas as entregas dos meses selecionados.':'Informe o valor recebido e o mês do contrato ao qual ele se refere.'}</DialogDescription></DialogHeader>
  <form className="finance-form" onSubmit={submit}>
   <fieldset className="company-fieldset" disabled={busy}>
    {value.type==='payment'?<>
     <div className="form-grid"><Field label="Data do recebimento *"><input name="receivedAt" required type="date" min="1900-01-01" max="9999-12-31" value={value.input.receivedAt} onChange={event=>setPayment('receivedAt',event.target.value)} autoFocus/></Field><Field label="Mês de referência *"><input name="referenceMonth" required type="month" min="1900-01" max="9999-12" value={value.input.referenceMonth} onChange={event=>setPayment('referenceMonth',event.target.value)}/></Field></div>
     <Field label="Valor recebido (R$) *"><CurrencyInput name="amount" required value={value.input.amount} onValueChange={amount=>setPayment('amount',amount)}/></Field>
     <Field label="Documento ou comprovante"><input name="document" maxLength={100} placeholder="Número do recibo, transferência ou nota" value={value.input.document} onChange={event=>setPayment('document',event.target.value)}/></Field>
     <Field label="Observações"><textarea name="notes" maxLength={1000} rows={3} value={value.input.notes} onChange={event=>setPayment('notes',event.target.value)}/></Field>
    </>:<>
     <Field label="Nome do acordo *"><input name="title" required maxLength={150} placeholder="Ex.: Acordo de desconto de setembro" value={value.input.title} onChange={event=>setDiscount('title',event.target.value)} autoFocus/></Field>
     <Field label="Desconto por tonelada (R$/t) *"><CurrencyInput name="ratePerTon" required maximumFractionDigits={6} value={value.input.ratePerTon} onValueChange={rate=>setDiscount('ratePerTon',rate)}/></Field>
     <fieldset className="finance-month-picker"><legend>Meses de aplicação *</legend><p>Marque somente os meses em que este acordo deve ser descontado.</p><div className="finance-month-options">{[...new Set([...knownMonths,...months])].sort().map(month=><label key={month} className={months.includes(month)?'selected':''}><input type="checkbox" checked={months.includes(month)} onChange={()=>{toggleMonth(month);setMonthError('');}}/>{formatContractMonth(month)}</label>)}</div><div className="finance-add-month"><input aria-label="Outro mês para o desconto" type="month" min="1900-01" max="9999-12" value={monthToAdd} onChange={event=>setMonthToAdd(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();addMonth();}}}/><button type="button" className="btn" disabled={!monthToAdd} onClick={addMonth}><Plus size={15}/>Incluir mês</button></div>{monthError&&<p className="form-error" role="alert">{monthError}</p>}</fieldset>
     <Field label="Observações do acordo"><textarea name="notes" maxLength={1000} rows={3} value={value.input.notes} onChange={event=>setDiscount('notes',event.target.value)}/></Field>
     <p className="finance-card-hint">Desconto do mês = R$/t × toneladas entregues no mês. Acordos diferentes no mesmo mês são somados. Para alterar a taxa em outro mês, cadastre outro acordo.</p>
    </>}
   </fieldset>
   {error&&<p className="form-error" role="alert">{error}</p>}
   <div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}><X size={15}/>Cancelar</button><button type="submit" className="btn company-primary" disabled={busy}>{busy?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {busy?'Salvando…':value.id?'Salvar alterações':`Lançar ${label}`}</button></div>
  </form>
 </DialogContent></Dialog>;
}
