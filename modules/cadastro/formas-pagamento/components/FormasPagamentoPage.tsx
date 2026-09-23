'use client';

import {useMemo,useState} from 'react';
import {CreditCard,Loader2,Pencil,Plus,RefreshCw,Search,Trash2} from 'lucide-react';
import {LocalSearch} from '@/shared/components/Common';
import {notifications,useConfirmation} from '@/shared/feedback';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {usePaymentMethodMutations,usePaymentMethods} from '../hooks/usePaymentMethods';
import type {PaymentMethod} from '../types';
import {PaymentMethodForm} from './PaymentMethodForm';
import '../styles.css';

export function FormasPagamentoPage(){
  const query=usePaymentMethods(),mutations=usePaymentMethodMutations(),confirm=useConfirmation();
  const [search,setSearch]=useState('');
  const [editing,setEditing]=useState<PaymentMethod|null|undefined>(undefined);
  const [deleting,setDeleting]=useState<string|null>(null);
  const methods=useMemo(()=>{const term=search.trim().toLocaleLowerCase('pt-BR');return query.paymentMethods.filter(method=>!term||`${method.name} ${method.description}`.toLocaleLowerCase('pt-BR').includes(term));},[query.paymentMethods,search]);
  const remove=async(method:PaymentMethod)=>{const accepted=await confirm({title:'Excluir forma de pagamento?',description:`A opção “${method.name}” será excluída. Se estiver vinculada a um pedido, a exclusão será impedida.`,confirmLabel:'Excluir forma',tone:'destructive'});if(!accepted)return;setDeleting(method.id);try{await mutations.remove(method.id);notifications.deleted(`A forma “${method.name}” foi excluída.`);}catch(reason){notifications.error((reason as Error).message||'Não foi possível excluir a forma de pagamento.');}finally{setDeleting(null);}};
  const add=<button className="btn company-primary" type="button" onClick={()=>setEditing(null)} disabled={mutations.saving||mutations.deleting}><Plus size={17}/>Cadastrar forma</button>;
  return <section className="payment-methods-workspace"><nav className="client-breadcrumb farm-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><span aria-hidden="true">›</span><span aria-current="page">Formas de pagamento</span></nav><div className="companies-heading"><div><h2>Formas de pagamento</h2><p>Cadastre condições como à vista, 7/14, 30/60 ou adiantamento para usar nos pedidos.</p></div>{!query.loading&&!query.error&&add}</div>
  {query.loading?<div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando formas de pagamento…</div>:query.error?<div className="company-empty" role="alert"><h3>Não foi possível carregar as formas de pagamento</h3><p>{query.error}</p><button className="btn" type="button" onClick={()=>void query.reload()}><RefreshCw size={16}/>Tentar novamente</button></div>:!query.paymentMethods.length?<div className="company-empty"><span className="company-empty-icon"><CreditCard size={25}/></span><h3>Nenhuma forma cadastrada</h3><p>Crie opções padronizadas para evitar textos diferentes em cada pedido.</p>{add}</div>:<><div className="payment-methods-toolbar"><LocalSearch value={search} onChange={setSearch} placeholder="Buscar forma de pagamento"/><span>{methods.length} de {query.paymentMethods.length}</span></div>{!methods.length?<div className="company-empty"><Search size={24}/><h3>Nenhuma forma encontrada</h3><button className="btn" type="button" onClick={()=>setSearch('')}>Limpar busca</button></div>:<div className="payment-methods-grid">{methods.map(method=><article className="payment-method-card" key={method.id}><span><CreditCard size={18}/></span><div><h3>{method.name}</h3><p>{method.description||'Sem descrição adicional.'}</p></div><div><button className="btn small" type="button" onClick={()=>setEditing(method)} disabled={mutations.saving||mutations.deleting}><Pencil size={14}/>Editar</button><button className="icon-btn payment-method-delete" type="button" aria-label={`Excluir ${method.name}`} onClick={()=>void remove(method)} disabled={mutations.saving||mutations.deleting}>{deleting===method.id?<Loader2 size={15} className="animate-spin"/>:<Trash2 size={15}/>}</button></div></article>)}</div>}</>}
  {editing!==undefined&&<PaymentMethodForm method={editing??undefined} onClose={()=>setEditing(undefined)} onSave={async input=>{const saved=await mutations.save(input);notifications[input.id?'updated':'created'](input.id?`A forma “${saved.name}” foi atualizada.`:`A forma “${saved.name}” foi cadastrada.`);setEditing(undefined);return saved;}}/>}</section>;
}
