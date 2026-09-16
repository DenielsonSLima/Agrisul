import {useEffect,useRef,useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,Banknote,CalendarDays,ChartNoAxesCombined,ChevronLeft,ChevronRight,CircleDollarSign,Clock3,FlaskConical,Info,Pencil,Plus,ReceiptText,Scissors,Trash2,Truck} from 'lucide-react';
import {notifications,useConfirmation} from '@/shared/feedback';
import {useContractFinance} from '../../hooks/useContractFinance';
import type {BillingContract,ContractDiscount,ContractPayment,ContractPaymentKind} from '../../types';
import {formatAtr,formatAtrCriterion,formatContractBilling as money,formatContractDate,formatContractMonth,formatContractVolume} from '../../utils/contractFormat';
import {ContractFinanceDialog,type FinanceDraft,financeToday} from './ContractFinanceDialog';
import {ContractFinanceCharts} from './ContractFinanceCharts';
import {ContractDiscountTables} from './ContractDiscountTables';
import './contractFinance.css';

export function ContractFinancialTab({contract:c,onBusy}:{contract:BillingContract;onBusy?:(busy:boolean)=>void}){
 const summary=c.financialSummary,mutation=useContractFinance(c.id),confirm=useConfirmation();
 const [month,setMonth]=useState(()=>financeToday().slice(0,7)),[draft,setDraft]=useState<FinanceDraft|null>(null),[error,setError]=useState('');
 const mounted=useRef(true),inFlight=useRef(false),trigger=useRef<HTMLElement|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{onBusy?.(mutation.isPending);return()=>onBusy?.(false);},[mutation.isPending,onBusy]);
 if(!summary)return <div className="contract-tab-empty" role="status"><CircleDollarSign/><h3>Financeiro indisponível</h3><p>Atualize o contrato para carregar os dados financeiros.</p></div>;
 const selected=summary.months.find(item=>item.month===month)??summary.emptyMonth,total=summary.totals;
 const open=(value:FinanceDraft)=>{trigger.current=document.activeElement as HTMLElement;setError('');setDraft(value);};
 const newPayment=(kind:ContractPaymentKind)=>open({type:'payment',input:{requestId:crypto.randomUUID(),kind,receivedAt:financeToday(),referenceMonth:month,amount:'',document:'',notes:''}});
 const editPayment=(payment:ContractPayment)=>open({type:'payment',id:payment.id,revision:payment.revision,input:{requestId:payment.requestId,kind:payment.kind,receivedAt:payment.receivedAt,referenceMonth:payment.referenceMonth,amount:payment.amount,document:payment.document,notes:payment.notes}});
 const editDiscount=(discount:ContractDiscount)=>open({type:'discount',id:discount.id,revision:discount.revision,input:{requestId:discount.requestId,title:discount.title,ratePerTon:discount.ratePerTon,months:discount.months,notes:discount.notes}});
 const save=async(value:FinanceDraft)=>{
  if(inFlight.current)return;inFlight.current=true;setError('');
  try{
   if(value.type==='payment')await mutation.mutateAsync({action:'save-payment',input:value.input,id:value.id,expectedRevision:value.revision});
   else await mutation.mutateAsync({action:'save-discount',input:value.input,id:value.id,expectedRevision:value.revision});
   if(mounted.current){setDraft(null);(value.id?notifications.updated:notifications.created)('O lançamento foi salvo e os totais do contrato foram atualizados.');}
  }catch(reason){if(mounted.current){const message=(reason as Error).message;setError(message);notifications.error(message);}}
  finally{inFlight.current=false;}
 };
 const remove=async(type:'payment'|'discount',entry:ContractPayment|ContractDiscount)=>{
  if(inFlight.current)return;
  const label=type==='discount'?'desconto':('kind' in entry&&entry.kind==='advance'?'adiantamento':'recebimento');
  if(!await confirm({title:`Excluir ${label}?`,description:type==='discount'?'O desconto deixará de ser aplicado aos meses selecionados. O total e o saldo pendente serão recalculados.':`O valor de ${money((entry as ContractPayment).amount)} será removido dos valores recebidos. O saldo pendente será recalculado.`,confirmLabel:`Excluir ${label}`,tone:'destructive'}))return;
  if(!mounted.current||inFlight.current)return;inFlight.current=true;
  try{await mutation.mutateAsync({action:type==='payment'?'delete-payment':'delete-discount',id:entry.id,expectedRevision:entry.revision});if(mounted.current){setError('');notifications.deleted('O lançamento foi excluído e os totais foram atualizados.');}}
  catch(reason){if(mounted.current){const message=(reason as Error).message;setError(message);notifications.error(message);}}
  finally{inFlight.current=false;}
 };
 const navigateMonth=(offset:number)=>{const date=new Date(month+'-01T12:00:00');date.setMonth(date.getMonth()+offset);setMonth(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`);};
 return <div className="contract-detail-tab contract-finance">
  <div className="finance-heading">
   <div><span className="finance-eyebrow"><ChartNoAxesCombined size={14}/>PAINEL FINANCEIRO</span><h3>Seu contrato em perspectiva.</h3><p>Da entrega ao recebimento, acompanhe cada resultado.</p></div>
   <div className="finance-period-control"><span>PERÍODO EM FOCO</span><div><button type="button" aria-label="Mês anterior" disabled={month==='1900-01'} onClick={()=>navigateMonth(-1)}><ChevronLeft size={16}/></button><label className="finance-month"><CalendarDays size={15}/><input aria-label="Mês de referência do financeiro" type="month" min="1900-01" max="9999-12" value={month} onChange={event=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)&&event.target.value>='1900-01')setMonth(event.target.value);}}/></label><button type="button" aria-label="Próximo mês" disabled={month==='9999-12'} onClick={()=>navigateMonth(1)}><ChevronRight size={16}/></button></div></div>
  </div>
  <section className="finance-balances" aria-label="Total, recebido e pendente">
   <Metric icon={<ReceiptText/>} label="Total após descontos" value={money(selected.netAmount,selected.billingPending)} overall={money(total.netAmount,total.billingPending)} month={month} tone="total" note="Valor líquido das entregas"/>
   <Metric icon={<ArrowDownLeft/>} label="Total recebido" value={money(selected.receivedAmount)} overall={money(total.receivedAmount)} month={month} tone="received" note="Adiantamentos + recebimentos"/>
   <Metric icon={<Clock3/>} label="Pendente de receber" value={money(selected.pendingAmount,selected.billingPending)} overall={money(total.pendingAmount,total.billingPending)} month={month} tone="pending" note="Saldo após os valores recebidos"/>
  </section>
  {(total.creditAmount!==''&&total.creditAmount!=='0'||selected.creditAmount!==''&&selected.creditAmount!=='0')&&<p className="finance-credit"><ArrowUpRight size={16}/>Valor recebido além do total: <strong>{money(selected.creditAmount,selected.billingPending)}</strong> no mês · <strong>{money(total.creditAmount,total.billingPending)}</strong> no contrato.</p>}
  {total.billingPending&&<p className="finance-notice" role="status">Há entregas sem o ATR medido ou sem a cotação do mês anterior, conforme o tipo selecionado no contrato. O valor entregue, o total e o pendente ficam em aberto até informar o ATR e cadastrar a cotação correspondente. Adiantamentos e recebimentos continuam disponíveis.</p>}
  <ContractFinanceCharts summary={summary} month={month} onMonth={setMonth}/>
  <section className="finance-deliveries" aria-label="Entregas no mês e no contrato">
   <DeliveryMetric icon={<Truck/>} label="Quantidade entregue" value={formatContractVolume(selected.loadedVolume)} overall={formatContractVolume(total.loadedVolume)}/>
   <DeliveryMetric icon={<FlaskConical/>} label="ATR médio · kg/t" value={formatAtr(selected.averageAtr)} overall={formatAtr(total.averageAtr)}/>
   <DeliveryMetric icon={<CircleDollarSign/>} label="Valor entregue" value={money(selected.grossAmount,selected.billingPending)} overall={money(total.grossAmount,total.billingPending)}/>
   <div className="finance-criterion"><span><Info size={12}/>Entregas de {formatContractMonth(month)} · ATR ponderado pelo volume.</span><span>Cotação do mês anterior · <b>{formatAtrCriterion(c.atrPriceType,c.atrPeriodType)}</b></span></div>
  </section>
  <div className="finance-section-heading"><div><span className="finance-eyebrow">MOVIMENTAÇÕES</span><h3>Entradas e acordos</h3></div><span><CalendarDays size={13}/>{formatContractMonth(month)}</span></div>
  {error&&!draft&&<p className="form-error" role="alert">{error}</p>}
  <div className="finance-payment-grid">
   {(['advance','receipt'] as const).map(kind=>{
    const isAdvance=kind==='advance',entries=summary.payments.filter(payment=>payment.kind===kind&&payment.referenceMonth===month);
    return <section className={'finance-card finance-payment-card '+(isAdvance?'finance-advance-card':'finance-receipt-card')} key={kind} aria-label={isAdvance?'Adiantamentos':'Recebimentos'}>
     <header><div className="finance-card-title">{isAdvance?<Banknote size={19}/>:<ArrowDownLeft size={19}/>}<h3>{isAdvance?'Adiantamentos':'Recebimentos'}</h3></div><button type="button" className="btn" disabled={mutation.isPending} onClick={()=>newPayment(kind)}><Plus size={15}/>{isAdvance?'Lançar adiantamento':'Lançar recebimento'}</button></header>
     <div className="finance-card-amount"><strong>{money(isAdvance?selected.advanceAmount:selected.receiptAmount)}</strong><span>em {formatContractMonth(month)} · Geral: {money(isAdvance?total.advanceAmount:total.receiptAmount)}</span></div>
     <p className="finance-card-hint">{isAdvance?'Valores antecipados que já abatem o saldo do contrato.':'Pagamentos recebidos, sem repetir os valores de adiantamentos.'}</p>
     {entries.length?<ul className="finance-entry-list">{entries.map(entry=><li key={entry.id}><span className="finance-entry-icon"><ArrowDownLeft size={15}/></span><div><strong>{money(entry.amount)}</strong><span>Recebido em {formatContractDate(entry.receivedAt)}{entry.document?' · '+entry.document:''}</span>{entry.notes&&<p>{entry.notes}</p>}</div><div className="finance-entry-actions"><button type="button" aria-label={`Editar ${isAdvance?'adiantamento':'recebimento'} de ${money(entry.amount)}`} disabled={mutation.isPending} onClick={()=>editPayment(entry)}><Pencil size={15}/></button><button type="button" aria-label={`Excluir ${isAdvance?'adiantamento':'recebimento'} de ${money(entry.amount)}`} disabled={mutation.isPending} onClick={()=>{void remove('payment',entry);}}><Trash2 size={15}/></button></div></li>)}</ul>:<div className="finance-empty"><span>{isAdvance?<Banknote size={21}/>:<ArrowDownLeft size={21}/>}</span><strong>Nenhum {isAdvance?'adiantamento':'recebimento'} neste mês</strong><p>Os valores lançados para {formatContractMonth(month)} aparecerão aqui.</p></div>}
    </section>;
   })}
  </div>
  <section className="finance-card finance-discounts" aria-label="Descontos por tonelada">
   <header><div className="finance-card-title"><Scissors size={19}/><div><h3>Descontos por tonelada</h3><span>Toneladas carregadas e descontos, mês a mês</span></div></div><button type="button" className="btn" disabled={mutation.isPending} onClick={()=>open({type:'discount',input:{requestId:crypto.randomUUID(),title:'',ratePerTon:'',months:[month],notes:''}})}><Plus size={15}/>Adicionar desconto</button></header>
   {summary.discounts.length?<ContractDiscountTables summary={summary} month={month} busy={mutation.isPending} onMonth={setMonth} onEdit={editDiscount} onRemove={entry=>{void remove('discount',entry);}}/>:<p className="finance-empty">Nenhum desconto cadastrado. Adicione um acordo, informe o valor por tonelada e escolha os meses de aplicação.</p>}
  </section>
  <section className="finance-card finance-monthly" aria-label="Histórico financeiro mensal"><header><div><h3>Histórico mensal</h3><p className="finance-card-hint">Selecione um mês para consultar seus lançamentos acima. O saldo de cada mês usa os pagamentos atribuídos àquela referência.</p></div></header><div className="contract-table-wrap"><table className="contract-table"><thead><tr><th>Mês</th><th>Entregue (t)</th><th>ATR médio</th><th>Valor entregue</th><th>Descontos</th><th>Total</th><th>Adiantamentos</th><th>Recebimentos</th><th>Pendente</th></tr></thead><tbody>{summary.months.map(item=><tr key={item.month} className={item.month===month?'finance-selected-row':''}><td><button type="button" onClick={()=>setMonth(item.month)} aria-pressed={item.month===month}>{formatContractMonth(item.month)}</button></td><td>{formatContractVolume(item.loadedVolume)}</td><td>{formatAtr(item.averageAtr)}</td><td>{money(item.grossAmount,item.billingPending)}</td><td>{money(item.discountAmount)}</td><td>{money(item.netAmount,item.billingPending)}</td><td>{money(item.advanceAmount)}</td><td>{money(item.receiptAmount)}</td><td>{money(item.pendingAmount,item.billingPending)}</td></tr>)}</tbody><tfoot><tr><th>Geral do contrato</th><td>{formatContractVolume(total.loadedVolume)}</td><td>{formatAtr(total.averageAtr)}</td><td>{money(total.grossAmount,total.billingPending)}</td><td>{money(total.discountAmount)}</td><td>{money(total.netAmount,total.billingPending)}</td><td>{money(total.advanceAmount)}</td><td>{money(total.receiptAmount)}</td><td>{money(total.pendingAmount,total.billingPending)}</td></tr></tfoot></table></div></section>
  {draft&&<ContractFinanceDialog draft={draft} knownMonths={summary.months.map(item=>item.month)} busy={mutation.isPending} error={error} onSave={save} onClose={()=>{if(!inFlight.current)setDraft(null);}} onRestoreFocus={()=>{if(trigger.current?.isConnected)trigger.current.focus();}}/>}
 </div>;
}

function Metric({icon,label,value,overall,month,tone,note}:{icon:React.ReactNode;label:string;value:string;overall:string;month:string;tone:string;note:string}){
 return <article className={'finance-metric finance-metric-'+tone}><header><span className="finance-metric-icon">{icon}</span><h4>{label}</h4><small>{formatContractMonth(month)}</small></header><strong>{value}</strong><span className="finance-metric-note">{note}</span><footer><span>Geral do contrato</span><b>{overall}</b></footer></article>;
}

function DeliveryMetric({icon,label,value,overall}:{icon:React.ReactNode;label:string;value:string;overall:string}){
 return <article className="finance-delivery-metric"><span>{icon}</span><div><h4>{label}</h4><strong>{value}</strong><p>Geral <b>{overall}</b></p></div></article>;
}
