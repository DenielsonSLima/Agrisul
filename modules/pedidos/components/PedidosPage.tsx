'use client';

/* eslint-disable @next/next/no-img-element -- Material photos use short-lived private Storage URLs. */
import {useState} from 'react';
import {ArrowLeft,ArrowRight,Building2,CalendarDays,CheckCircle2,ChevronRight,CircleDot,ClipboardList,CreditCard,FileDown,FileText,Hash,ImageOff,Loader2,Mail,MapPin,PackageCheck,Phone,RefreshCw,Save,Search,ShoppingCart} from 'lucide-react';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Choice,Field,LocalSearch} from '@/shared/components/Common';
import {notifications,useConfirmation} from '@/shared/feedback';
import {ModuleLink,useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {dateLabel,moneyLabel} from '@/shared/utils/presentation';
import {usePaymentMethods} from '@/modules/cadastro/formas-pagamento/hooks/usePaymentMethods';
import {usePurchaseOrder,usePurchaseOrderMutations,usePurchaseOrders} from '../hooks/usePurchaseOrders';
import type {PurchaseOrder,PurchaseOrderFilters,PurchaseOrderInput,PurchaseOrderStatus} from '../types';
import {PurchaseOrderExportDialog} from './PurchaseOrderExportDialog';
import '../styles.css';

const baseHref='/pedidos';

function filtersFrom(searchParams:URLSearchParams):PurchaseOrderFilters{
  return {status:searchParams.get('aba')==='finalizados'?'finished':'open',search:(searchParams.get('busca')??'').slice(0,160),dateFrom:searchParams.get('de')??'',dateTo:searchParams.get('ate')??''};
}
function purchaseOrdersHref(filters:PurchaseOrderFilters,id?:string){
  const params=new URLSearchParams();
  if(filters.status==='finished')params.set('aba','finalizados');
  if(filters.search)params.set('busca',filters.search);
  if(filters.dateFrom)params.set('de',filters.dateFrom);
  if(filters.dateTo)params.set('ate',filters.dateTo);
  if(id)params.set('pedido',id);
  const query=params.toString();return query?`${baseHref}?${query}`:baseHref;
}
function documentLabel(order:PurchaseOrder){
  const raw=order.providerDocument;
  if(!raw)return `${order.providerDocumentType||'CNPJ'} não informado`;
  const digits=raw.replace(/\D/g,'');
  if(order.providerDocumentType==='CPF'&&digits.length===11)return `CPF ${digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4')}`;
  if(order.providerDocumentType==='CNPJ'&&digits.length===14)return `CNPJ ${digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5')}`;
  return `${order.providerDocumentType||'Documento'} ${raw}`;
}

export function PedidosPage(){
  const {searchParams}=useModuleNavigation();
  const filters=filtersFrom(searchParams);
  const id=searchParams.get('pedido');
  return <section className="purchase-orders-page">{id?<PurchaseOrderScreen id={id} filters={filters}/>:<PurchaseOrderList filters={filters}/>}</section>;
}

function PurchaseOrderList({filters}:{filters:PurchaseOrderFilters}){
  const {navigate}=useModuleNavigation();
  const query=usePurchaseOrders(filters);
  const change=(patch:Partial<PurchaseOrderFilters>)=>navigate(purchaseOrdersHref({...filters,...patch}));
  return <>
    <nav className="client-breadcrumb" aria-label="Caminho de navegação"><span aria-current="page">Pedidos</span></nav>
    <div className="companies-heading purchase-orders-heading"><div><span className="eyebrow">COMPRAS</span><h2>Pedidos</h2><p>Acompanhe as compras geradas a partir das cotações finalizadas.</p></div><span className="purchase-orders-count"><ShoppingCart size={17}/><strong>{query.counts.open+query.counts.finished}</strong> pedidos</span></div>
    <Tabs value={filters.status} onValueChange={value=>change({status:value as PurchaseOrderStatus})} className="purchase-orders-tabs"><TabsList variant="line" aria-label="Situação dos pedidos"><TabsTrigger value="open"><CircleDot size={16}/>Em aberto<span>{query.counts.open}</span></TabsTrigger><TabsTrigger value="finished"><CheckCircle2 size={16}/>Finalizados<span>{query.counts.finished}</span></TabsTrigger></TabsList><TabsContent value={filters.status}><PurchaseOrderFiltersBar key={`${filters.search}:${filters.dateFrom}:${filters.dateTo}`} filters={filters} onApply={change}/>
      {query.loading?<LoadState text="Carregando pedidos…"/>:query.error?<div className="company-empty" role="alert"><h3>Não foi possível carregar os pedidos</h3><p>{query.error}</p><button type="button" className="btn" onClick={()=>void query.reload()}><RefreshCw size={16}/>Tentar novamente</button></div>:!query.orders.length?<div className="company-empty"><span className="company-empty-icon">{filters.search||filters.dateFrom||filters.dateTo?<Search size={25}/>:<PackageCheck size={25}/>}</span><h3>{filters.search||filters.dateFrom||filters.dateTo?'Nenhum pedido com esses filtros':filters.status==='open'?'Nenhum pedido em aberto':'Nenhum pedido finalizado'}</h3><p>{filters.status==='open'?'Pedidos gerados pelas cotações aparecem aqui até a finalização.':'Os pedidos concluídos ficam preservados nesta aba.'}</p>{filters.search||filters.dateFrom||filters.dateTo?<button className="btn" type="button" onClick={()=>change({search:'',dateFrom:'',dateTo:''})}>Limpar filtros</button>:<ModuleLink className="btn" href="/cotacao"><FileText size={16}/>Ver cotações</ModuleLink>}</div>:<><div className="purchase-orders-result"><span><strong>{query.total}</strong> {query.total===1?'pedido encontrado':'pedidos encontrados'}</span><small>Período pela data da cotação</small></div><div className="purchase-order-grid">{query.orders.map(order=><PurchaseOrderCard key={order.id} order={order} href={purchaseOrdersHref(filters,order.id)}/>)}</div></>}
    </TabsContent></Tabs>
  </>;
}

function PurchaseOrderFiltersBar({filters,onApply}:{filters:PurchaseOrderFilters;onApply:(patch:Partial<PurchaseOrderFilters>)=>void}){
  const [search,setSearch]=useState(filters.search),[dateFrom,setDateFrom]=useState(filters.dateFrom),[dateTo,setDateTo]=useState(filters.dateTo);
  const apply=()=>onApply({search:search.trim(),dateFrom,dateTo});
  const clear=()=>{setSearch('');setDateFrom('');setDateTo('');onApply({search:'',dateFrom:'',dateTo:''});};
  return <form className="purchase-orders-toolbar" onSubmit={event=>{event.preventDefault();apply();}}><LocalSearch value={search} onChange={setSearch} placeholder="Buscar empresa, CNPJ, pedido, cotação ou OC"/><label><span>Período inicial</span><input type="date" value={dateFrom} max={dateTo||undefined} onChange={event=>setDateFrom(event.target.value)}/></label><label><span>Período final</span><input type="date" value={dateTo} min={dateFrom||undefined} onChange={event=>setDateTo(event.target.value)}/></label><div><button className="btn company-primary" type="submit"><Search size={15}/>Filtrar</button>{(filters.search||filters.dateFrom||filters.dateTo)&&<button className="btn" type="button" onClick={clear}>Limpar</button>}</div></form>;
}

function PurchaseOrderCard({order,href}:{order:PurchaseOrder;href:string}){
  return <ModuleLink href={href} className="purchase-order-card" aria-label={`Abrir pedido ${order.number}`}><header><span className="purchase-order-card-icon"><ClipboardList size={20}/></span><span className={`purchase-order-status is-${order.status}`}>{order.status==='open'?'Em aberto':'Finalizado'}</span></header><div className="purchase-order-company"><small>EMPRESA</small><h3>{order.providerLegalName||'Empresa não informada'}</h3><p>{order.providerTradeName||'Nome fantasia não informado'}</p><span>{documentLabel(order)}</span></div><dl><div><dt>Nº da cotação</dt><dd>{order.quotationNumber||'—'}</dd></div><div><dt>Ordem de compra</dt><dd>{order.purchaseOrderNumber||'Não informada'}</dd></div><div><dt>Data da cotação</dt><dd>{dateLabel(order.requestDate)}</dd></div></dl><footer><div><PackageCheck size={15}/><span><strong>{order.itemCount}</strong> {order.itemCount===1?'item':'itens'}</span></div><strong>{moneyLabel(order.total)}</strong></footer><span className="purchase-order-open">Ver pedido completo <ArrowRight size={14}/></span></ModuleLink>;
}

function PurchaseOrderScreen({id,filters}:{id:string;filters:PurchaseOrderFilters}){
  const {navigate}=useModuleNavigation();
  const query=usePurchaseOrder(id);
  const listHref=purchaseOrdersHref(filters);
  return <><nav className="client-breadcrumb purchase-order-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href={baseHref}>Pedidos</ModuleLink><ChevronRight size={13}/><ModuleLink href={listHref}>{filters.status==='open'?'Em aberto':'Finalizados'}</ModuleLink><ChevronRight size={13}/><span aria-current="page">{query.order?.number||'Detalhes'}</span></nav>{query.loading?<LoadState text="Carregando pedido…"/>:query.error||!query.order?<><button className="purchase-order-back" type="button" onClick={()=>navigate(listHref)}><ArrowLeft size={16}/>Voltar para pedidos</button><div className="company-empty" role="alert"><h3>Não foi possível carregar o pedido</h3><p>{query.error||'Pedido não encontrado.'}</p><button className="btn" type="button" onClick={()=>void query.reload()}><RefreshCw size={16}/>Tentar novamente</button></div></>:<PurchaseOrderDetail key={`${query.order.id}:${query.order.updatedAt}`} order={query.order} reload={query.reload} onBack={()=>navigate(listHref)}/>}</>;
}

function PurchaseOrderDetail({order,reload,onBack}:{order:PurchaseOrder;reload:()=>Promise<void>;onBack:()=>void}){
  const methods=usePaymentMethods(),mutations=usePurchaseOrderMutations(),confirm=useConfirmation();
  const [form,setForm]=useState<PurchaseOrderInput>({id:order.id,paymentMethodId:order.paymentMethodId,purchaseOrderNumber:order.purchaseOrderNumber});
  const [error,setError]=useState(''),[exporting,setExporting]=useState(false);
  const busy=mutations.saving||mutations.finishing;
  const set=(field:'paymentMethodId'|'purchaseOrderNumber',value:string|null)=>{setForm(current=>({...current,[field]:value}));setError('');};
  const save=async(event:React.FormEvent)=>{event.preventDefault();if(!form.paymentMethodId){setError('Selecione uma forma de pagamento cadastrada.');return;}setError('');try{await mutations.save({...form,purchaseOrderNumber:form.purchaseOrderNumber.trim()});notifications.saved('Os dados comerciais do pedido foram atualizados.');await reload();}catch(reason){const message=(reason as Error).message||'Não foi possível salvar o pedido.';setError(message);notifications.error(message);}};
  const finish=async()=>{if(!order.paymentMethodId){setError('Salve a forma de pagamento antes de finalizar o pedido.');return;}const accepted=await confirm({title:'Finalizar pedido?',description:`O pedido ${order.number} sairá da fila em aberto e ficará preservado na aba Finalizados.`,confirmLabel:'Finalizar pedido'});if(!accepted)return;try{await mutations.finish(order.id);notifications.updated(`O pedido ${order.number} foi finalizado.`);await reload();}catch(reason){const message=(reason as Error).message||'Não foi possível finalizar o pedido.';setError(message);notifications.error(message);}};
  const phone=order.providerPhone.replace(/\D/g,'');
  return <div className="purchase-order-detail-page"><button className="purchase-order-back" type="button" onClick={onBack}><ArrowLeft size={16}/>Voltar para pedidos</button><div className="purchase-order-detail-heading"><div><span className="eyebrow">PEDIDO DE COMPRA</span><div><h2>{order.number}</h2><span className={`purchase-order-status is-${order.status}`}>{order.status==='open'?'Em aberto':'Finalizado'}</span></div><p>Gerado pela cotação {order.quotationNumber} em {dateLabel(order.requestDate)}</p></div><div className="purchase-order-detail-actions"><button className="btn" type="button" onClick={()=>setExporting(true)}><FileDown size={16}/>Exportar pedido</button>{order.status==='open'&&<button className="btn company-primary" type="button" disabled={busy} onClick={()=>void finish()}>{mutations.finishing?<Loader2 size={16} className="animate-spin"/>:<CheckCircle2 size={16}/>}Finalizar</button>}</div></div>
  <div className="purchase-order-kpis"><article><span><Building2 size={19}/></span><div><small>Fornecedor</small><strong>{order.providerLegalName}</strong><p>{order.providerTradeName||'Sem nome fantasia'}</p></div></article><article><span><PackageCheck size={19}/></span><div><small>Itens do pedido</small><strong>{order.itemCount}</strong><p>{order.itemCount===1?'Item aprovado':'Itens aprovados'}</p></div></article><article><span><ShoppingCart size={19}/></span><div><small>Valor total</small><strong>{moneyLabel(order.total)}</strong><p>Calculado na cotação</p></div></article><article><span><Hash size={19}/></span><div><small>Ordem de compra</small><strong>{order.purchaseOrderNumber||'Pendente'}</strong><p>{order.status==='finished'?'Pedido finalizado':'Preenchimento opcional'}</p></div></article></div>
  <div className="purchase-order-detail-layout"><main><section className="purchase-order-panel"><div className="purchase-order-section-heading"><PackageCheck size={19}/><div><h3>Itens do pedido</h3><p>Fotos, quantidades e valores definidos na cotação.</p></div></div><div className="purchase-order-item-list">{order.items.map(item=><article key={item.id} className="purchase-order-item"><div className="purchase-order-item-image">{item.materialImageUrl?<img src={item.materialImageUrl} alt={`Foto de ${item.materialName}`}/>:<ImageOff size={22}/>}</div><div className="purchase-order-item-copy"><small>{item.materialInternalCode||'SEM CÓDIGO INTERNO'}</small><h4>{item.materialName}</h4>{item.materialReferences.length>0&&<p>{item.materialReferences.map(reference=>[reference.brand,reference.code].filter(Boolean).join(' · ')).join(' | ')}</p>}{item.materialApplication&&<p>Aplicação: {item.materialApplication}</p>}{item.notes&&<p>Observação: {item.notes}</p>}</div><dl><div><dt>Quantidade</dt><dd>{item.quantity} {item.unit}</dd></div><div><dt>Valor unitário</dt><dd>{moneyLabel(item.unitPrice)}</dd></div><div><dt>Total</dt><dd>{moneyLabel(item.lineTotal)}</dd></div></dl></article>)}</div><div className="purchase-order-items-total"><span>Total do pedido</span><strong>{moneyLabel(order.total)}</strong></div></section></main><aside><section className="purchase-order-panel purchase-order-supplier"><div className="purchase-order-section-heading"><Building2 size={19}/><div><h3>Dados do fornecedor</h3><p>Cadastro preservado no pedido.</p></div></div><dl><div><dt>{order.providerDocumentType==='CPF'?'Nome':'Razão social'}</dt><dd>{order.providerLegalName||'Não informado'}</dd></div><div><dt>{order.providerDocumentType==='CPF'?'Nome profissional':'Nome fantasia'}</dt><dd>{order.providerTradeName||'Não informado'}</dd></div><div><dt>{order.providerDocumentType||'Documento'}</dt><dd>{documentLabel(order).replace(/^\S+\s/,'')}</dd></div>{order.providerAddress&&<div><dt>Endereço</dt><dd><MapPin size={13}/>{order.providerAddress}</dd></div>}{order.providerEmail&&<div><dt>E-mail</dt><dd><a href={`mailto:${order.providerEmail}`}><Mail size={13}/>{order.providerEmail}</a></dd></div>}{order.providerPhone&&<div><dt>Telefone</dt><dd><a href={phone?`https://wa.me/${phone}`:`tel:${order.providerPhone}`} target={phone?'_blank':undefined} rel={phone?'noreferrer':undefined}><Phone size={13}/>{order.providerPhone}</a></dd></div>}</dl></section><form className="purchase-order-panel purchase-order-commercial" onSubmit={event=>void save(event)}><div className="purchase-order-section-heading"><CreditCard size={19}/><div><h3>Condições comerciais</h3><p>Selecione uma opção cadastrada.</p></div></div><fieldset disabled={busy||order.status==='finished'}><Field label="Forma de pagamento *"><Choice label="Selecionar forma de pagamento" value={form.paymentMethodId??''} onChange={value=>set('paymentMethodId',value)} items={methods.paymentMethods.map(method=>({value:method.id,label:method.name,description:method.description||undefined}))} disabled={methods.loading||!!methods.error}/></Field><Field label="Número da ordem de compra"><input maxLength={100} value={form.purchaseOrderNumber} onChange={event=>set('purchaseOrderNumber',event.target.value)} placeholder="Ex.: OC-2026-00125"/></Field></fieldset>{methods.error&&<p className="form-error" role="alert">{methods.error} <ModuleLink href="/cadastro?secao=formas-pagamento">Abrir cadastro</ModuleLink></p>}{!methods.loading&&!methods.error&&!methods.paymentMethods.length&&<p className="purchase-order-method-note">Cadastre uma forma antes de salvar. <ModuleLink href="/cadastro?secao=formas-pagamento">Cadastrar agora</ModuleLink></p>}{error&&<p className="form-error" role="alert">{error}</p>}{order.status==='open'?<div className="purchase-order-commercial-actions"><ModuleLink className="btn" href="/cadastro?secao=formas-pagamento">Gerenciar formas</ModuleLink><button className="btn company-primary" type="submit" disabled={busy||methods.loading||!methods.paymentMethods.length}>{mutations.saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>}Salvar</button></div>:<div className="purchase-order-finished-note"><CheckCircle2 size={16}/>Finalizado em {order.finishedAt?dateLabel(order.finishedAt.slice(0,10)):'data não informada'}</div>}</form><section className="purchase-order-panel purchase-order-origin"><div className="purchase-order-section-heading"><CalendarDays size={19}/><div><h3>Origem</h3><p>Rastro da compra.</p></div></div><dl><div><dt>Pedido</dt><dd>{order.number}</dd></div><div><dt>Cotação</dt><dd>{order.quotationNumber}</dd></div><div><dt>Solicitante</dt><dd>{order.quotationTitle||'Não informado'}</dd></div><div><dt>Data</dt><dd>{dateLabel(order.requestDate)}</dd></div></dl></section></aside></div>{exporting&&<PurchaseOrderExportDialog order={order} onClose={()=>setExporting(false)}/>}</div>;
}

function LoadState({text}:{text:string}){return <div className="client-loading" role="status"><Loader2 className="animate-spin" size={20}/>{text}</div>;}
