'use client';
/* Product photos are signed private catalog assets. */
/* eslint-disable @next/next/no-img-element */
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowLeft,ChevronLeft,ChevronRight,ClipboardList,Download,Filter,Loader2,Pencil,Plus,Save,Search,ShoppingBag,Trash2} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import {notifications,useConfirmation} from '@/shared/feedback';
import {ModuleLink,useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useMaterials} from '@/modules/cotacao/hooks/useQuotes';
import type {Material} from '@/modules/cotacao/types';
import {useFleet} from '@/modules/cadastro/frota/hooks/useFleet';
import type {FleetVehicle} from '@/modules/cadastro/frota/types';
import {useMaterialCategories} from '@/modules/cadastro/categorias/hooks/useMaterialCategories';
import type {MaterialCategory} from '@/modules/cadastro/categorias/types';
import {usePurchaseMutations,usePurchaseRequests} from '../hooks/usePurchaseRequests';
import type {PurchaseFilters,PurchaseInput,PurchaseRequest,PurchaseStatus} from '../purchaseTypes';
import '../purchases.css';

const statuses:Record<PurchaseStatus,string>={open:'Aberta',ordered:'Em compra',received:'Recebida',cancelled:'Cancelada'};
const dateLabel=(value:string)=>value.split('-').reverse().join('/');
const quantityLabel=(value:string)=>value.replace('.',',');
function blankInput():PurchaseInput{
 const now=new Date(),date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
 return {id:crypto.randomUUID(),requestedOn:date,requestNumber:'',itemType:'material',materialId:null,categoryId:null,description:'',reference:'',quantity:'1',unit:'PC',application:'',urgent:false,status:'open',notes:'',vehicleIds:[]};
}
function editInput(row:PurchaseRequest):PurchaseInput{
 return {id:row.id,requestedOn:row.requestedOn,requestNumber:row.requestNumber,itemType:row.itemType,materialId:row.materialId,categoryId:row.categoryId,description:row.description,reference:row.reference,quantity:row.quantity,unit:row.unit,application:row.application,urgent:row.urgent,status:row.status,notes:row.notes,vehicleIds:row.vehicles.map(v=>v.id),expectedUpdatedAt:row.updatedAt};
}
export function ComprasPage(){const {user}=useAuth();return <PurchaseWorkspace key={user?.id??'anonymous'}/>;}
function PurchaseWorkspace(){
 const {searchParams,navigate}=useModuleNavigation();
 const rawPage=searchParams.get('pagina')??'1',rawStatus=searchParams.get('situacao')??'all';
 const filters:PurchaseFilters={search:searchParams.get('busca')??'',status:Object.hasOwn(statuses,rawStatus)?rawStatus as PurchaseStatus:'all',categoryId:searchParams.get('grupo')??'',dateFrom:searchParams.get('de')??'',dateTo:searchParams.get('ate')??'',page:/^[1-9]\d{0,6}$/.test(rawPage)?Number(rawPage):1,pageSize:50};
 const list=usePurchaseRequests(filters),materials=useMaterials(),fleet=useFleet(),categories=useMaterialCategories(),mutations=usePurchaseMutations();
 const confirm=useConfirmation();
 const [draft,setDraft]=useState<PurchaseInput|null>(null),[formError,setFormError]=useState('');
 const createButton=useRef<HTMLButtonElement>(null);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const changeFilters=(patch:Partial<PurchaseFilters>)=>{
  const next={...filters,page:1,...patch},params=new URLSearchParams({secao:'compras'});
  if(next.search)params.set('busca',next.search);if(next.status!=='all')params.set('situacao',next.status);if(next.categoryId)params.set('grupo',next.categoryId);if(next.dateFrom)params.set('de',next.dateFrom);if(next.dateTo)params.set('ate',next.dateTo);if(next.page>1)params.set('pagina',String(next.page));navigate(`/solicitacoes?${params}`);
 };
 const begin=(row?:PurchaseRequest)=>{setFormError('');setDraft(row?editInput(row):blankInput());};
 const submit=async(input:PurchaseInput)=>{
  try{setFormError('');const result=await mutations.save(input);if(!mounted.current)return;setDraft(null);if(result.created)notifications.created('O item da solicitação de compra foi cadastrado.');else notifications.updated('O item da solicitação de compra foi atualizado.');}
  catch(error){if(!mounted.current)return;const message=(error as Error).message;setFormError(message);notifications.error(message);}
 };
 const remove=async(row:PurchaseRequest)=>{
  if(!await confirm({title:'Excluir item da solicitação?',description:`O item “${row.description}” da solicitação nº ${row.requestNumber} será excluído. O material e os veículos permanecem cadastrados.`,confirmLabel:'Excluir item',tone:'destructive'}))return;
  try{await mutations.remove({id:row.id,expectedUpdatedAt:row.updatedAt});if(mounted.current)notifications.deleted('O item foi excluído da solicitação.');}catch(error){if(mounted.current)notifications.error((error as Error).message);}
 };
 const exportPage=()=>{
  const rows=[['Data','Solicitação','Tipo','Grupo','Descrição','Referência','Quantidade','Unidade','Aplicação','Frotas','Urgente','Situação','Observações'],...(list.data?.items??[]).map(r=>[dateLabel(r.requestedOn),r.requestNumber,r.itemType==='service'?'Serviço':'Material',r.categoryName,r.description,r.reference,quantityLabel(r.quantity),r.unit,r.application,r.vehicles.map(v=>v.internalCode).join('/'),r.urgent?'Sim':'Não',statuses[r.status],r.notes])];
  const escape=(cell:string)=>`"${(/^[=+@\-\t\r]/.test(cell)?"'":"")+cell.replaceAll('"','""')}"`;
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(escape).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`solicitacoes-de-compra-pagina-${filters.page}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const photoMap=new Map(materials.materials.map(m=>[m.id,m.imageUrl]));
 const pages=Math.max(1,Math.ceil((list.data?.total??0)/filters.pageSize));
 const catalogsError=materials.error||fleet.error||categories.error;
 return <section className="requests-workspace purchases-workspace">
  <nav className="request-breadcrumb" aria-label="Caminho da solicitação"><ModuleLink href="/solicitacoes">Solicitações</ModuleLink><ChevronRight size={13}/><span aria-current="page">Compras</span></nav>
  <ModuleLink className="request-back" href="/solicitacoes"><ArrowLeft size={16}/>Voltar para solicitações</ModuleLink>
  <div className="request-heading"><div><span className="eyebrow">SOLICITAÇÕES / COMPRAS</span><h2>Solicitações de compras</h2><p>Materiais, serviços e aplicações na frota, organizados por item.</p></div><button ref={createButton} className="btn company-primary" disabled={!list.data?.canManage||mutations.saving} onClick={()=>begin()}><Plus size={17}/>Novo item</button></div>
  <div className="purchase-catalog-links"><ModuleLink href="/cadastro?secao=materiais">Materiais e fotos</ModuleLink><ModuleLink href="/cadastro?secao=categorias">Grupos de materiais</ModuleLink><ModuleLink href="/cadastro?secao=frota">Veículos e equipamentos</ModuleLink></div>
  <form key={JSON.stringify(filters)} className="purchase-filters" onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget);changeFilters({search:String(values.get('search')??''),status:String(values.get('status')) as PurchaseFilters['status'],categoryId:String(values.get('categoryId')??''),dateFrom:String(values.get('dateFrom')??''),dateTo:String(values.get('dateTo')??'')});}}>
   <label className="purchase-search"><Search size={16}/><span className="sr-only">Buscar solicitações</span><input name="search" maxLength={160} defaultValue={filters.search} placeholder="Produto, referência, nº ou frota…"/></label>
   <Field label="Situação"><select name="status" defaultValue={filters.status}><option value="all">Todas</option>{Object.entries(statuses).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></Field>
   <Field label="Grupo"><select name="categoryId" defaultValue={filters.categoryId}><option value="">Todos os grupos</option>{categories.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
   <Field label="De"><input type="date" name="dateFrom" defaultValue={filters.dateFrom}/></Field><Field label="Até"><input type="date" name="dateTo" defaultValue={filters.dateTo}/></Field><button className="btn" type="submit"><Filter size={15}/>Filtrar</button>
  </form>
  {catalogsError&&<div className="request-notice" role="alert"><p>Não foi possível carregar todos os cadastros: {catalogsError}</p><button className="btn" onClick={()=>{void materials.reload();void fleet.reload();void categories.reload();}}>Recarregar cadastros</button></div>}
  {list.loading?<div className="client-loading" role="status"><Loader2 className="animate-spin" size={20}/>Carregando solicitações…</div>:list.error?<div className="request-empty" role="alert"><h3>Não foi possível carregar as compras</h3><p>{list.error}</p><button className="btn" onClick={()=>void list.reload()}>Tentar novamente</button></div>:<>
   <div className="request-list-summary"><span><strong>{list.data?.total??0}</strong> itens encontrados</span><button className="btn" disabled={!list.data?.items.length} onClick={exportPage}><Download size={15}/>Exportar esta página</button></div>
   {!list.data?.items.length?<div className="request-empty"><span className="request-empty-icon"><ShoppingBag size={28}/></span><h3>Nenhum item encontrado</h3><p>Cadastre um item ou ajuste os filtros da tabela.</p></div>:<div className="request-table-wrap purchase-table-wrap"><table className="request-table purchase-table"><caption className="sr-only">Itens das solicitações de compras</caption><thead><tr>{['Data / solicitação','Material ou serviço','Referência','Qtd.','Un.','Aplicação / frota','Grupo','Situação','Ações'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{list.data.items.map(row=><tr key={row.id}>
    <td><time dateTime={row.requestedOn}>{dateLabel(row.requestedOn)}</time><strong className="purchase-number">Nº {row.requestNumber}</strong>{row.urgent&&<span className="purchase-urgent">Urgente</span>}</td>
    <td><div className="purchase-product">{row.materialId&&photoMap.get(row.materialId)?<img src={photoMap.get(row.materialId)!} alt="" loading="lazy"/>:<span className="purchase-photo-empty"><ClipboardList size={21}/></span>}<div><strong>{row.description}</strong><small>{row.itemType==='service'?'Serviço':'Material'}</small>{row.notes&&<details><summary>Observações</summary><p>{row.notes}</p></details>}</div></div></td>
    <td className="purchase-reference">{row.reference||'—'}</td><td className="purchase-quantity">{quantityLabel(row.quantity)}</td><td>{row.unit}</td><td><span>{row.application||'—'}</span>{!!row.vehicles.length&&<div className="purchase-vehicles">{row.vehicles.map(v=><span key={v.id} title={`${v.brand} ${v.model}`}>Frota {v.internalCode}</span>)}</div>}</td><td>{row.categoryName||'Sem grupo'}</td><td><span className={`purchase-status purchase-status-${row.status}`}>{statuses[row.status]}</span></td>
    <td><div className="purchase-actions"><button className="icon-btn" disabled={!list.data?.canManage||mutations.saving} aria-label={`Editar ${row.description}, solicitação ${row.requestNumber}`} onClick={()=>begin(row)}><Pencil size={15}/></button><button className="icon-btn" disabled={!list.data?.canManage||mutations.saving} aria-label={`Excluir ${row.description}, solicitação ${row.requestNumber}`} onClick={()=>void remove(row)}><Trash2 size={15}/></button></div></td>
   </tr>)}</tbody></table></div>}
   <nav className="request-pagination" aria-label="Paginação das solicitações de compras"><span>Página {filters.page} de {pages} · até {filters.pageSize} itens por página</span><div><button className="btn" disabled={filters.page<=1} onClick={()=>changeFilters({page:filters.page-1})}><ChevronLeft size={16}/>Anterior</button><button className="btn" disabled={filters.page>=pages} onClick={()=>changeFilters({page:filters.page+1})}>Próxima<ChevronRight size={16}/></button></div></nav>
  </>}
  <Dialog open={!!draft} onOpenChange={open=>{if(!open&&!mutations.saving)setDraft(null);}}><DialogContent className="form-modal purchase-modal" showCloseButton={!mutations.saving} onEscapeKeyDown={event=>{if(mutations.saving)event.preventDefault();}} onPointerDownOutside={event=>{if(mutations.saving)event.preventDefault();}} onCloseAutoFocus={()=>createButton.current?.focus()}>
   <DialogHeader><DialogTitle>{draft?.expectedUpdatedAt?'Editar item':'Novo item de compra'}</DialogTitle><DialogDescription>Informe a necessidade e os veículos ou o local de aplicação. O número pode reunir vários itens da mesma solicitação.</DialogDescription></DialogHeader>
   {draft&&<PurchaseForm key={draft.id} initial={draft} materials={materials.materials} vehicles={fleet.data?.vehicles??[]} categories={categories.categories} busy={mutations.saving} error={formError} onSave={submit} onClose={()=>setDraft(null)}/>}
  </DialogContent></Dialog>
 </section>;
}
function PurchaseForm({initial,materials,vehicles,categories,busy,error,onSave,onClose}:{initial:PurchaseInput;materials:Material[];vehicles:FleetVehicle[];categories:MaterialCategory[];busy:boolean;error:string;onSave:(input:PurchaseInput)=>Promise<void>;onClose:()=>void}){
 const [input,setInput]=useState(initial),[vehicleSearch,setVehicleSearch]=useState('');
 const patch=(values:Partial<PurchaseInput>)=>setInput(previous=>({...previous,...values}));
 const chooseMaterial=(id:string)=>{const material=materials.find(m=>m.id===id);patch({materialId:id||null,...material?{description:material.name,unit:material.unit,reference:material.references[0]?.code??material.internalCode,application:material.application,categoryId:material.categoryId}:{}});};
 const submit=(event:FormEvent)=>{event.preventDefault();if(!busy)void onSave(input);};
 const shownVehicles=vehicles.filter(v=>input.vehicleIds.includes(v.id)||`${v.internalCode} ${v.brand} ${v.model} ${v.partnerName??''}`.toLocaleLowerCase('pt-BR').includes(vehicleSearch.toLocaleLowerCase('pt-BR')));
 return <form onSubmit={submit} className="purchase-form"><fieldset disabled={busy}>
  <div className="form-grid"><Field label="Data da solicitação"><input type="date" required value={input.requestedOn} onChange={e=>patch({requestedOn:e.target.value})}/></Field><Field label="Nº da solicitação"><input required maxLength={60} value={input.requestNumber} onChange={e=>patch({requestNumber:e.target.value})}/></Field><Field label="Tipo"><select value={input.itemType} onChange={e=>patch({itemType:e.target.value as PurchaseInput['itemType'],materialId:null})}><option value="material">Material</option><option value="service">Serviço</option></select></Field><Field label="Situação"><select value={input.status} onChange={e=>patch({status:e.target.value as PurchaseStatus})}>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field></div>
  {input.itemType==='material'&&<Field label="Material cadastrado"><select value={input.materialId??''} onChange={e=>chooseMaterial(e.target.value)}><option value="">Descrição livre / selecionar material</option>{materials.map(m=><option key={m.id} value={m.id}>{m.name}{m.internalCode?` · ${m.internalCode}`:''}</option>)}</select></Field>}
  <Field label="Descrição"><input required minLength={2} maxLength={300} value={input.description} onChange={e=>patch({description:e.target.value})}/></Field>
  <div className="form-grid"><Field label="Referência / especificação"><input maxLength={150} value={input.reference} onChange={e=>patch({reference:e.target.value})}/></Field><Field label="Grupo"><select disabled={!!input.materialId} value={input.categoryId??''} onChange={e=>patch({categoryId:e.target.value||null})}><option value="">Sem grupo</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Quantidade"><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,6})?" value={input.quantity} onChange={e=>patch({quantity:e.target.value})}/></Field><Field label="Unidade"><input required maxLength={30} list="purchase-units" value={input.unit} onChange={e=>patch({unit:e.target.value})}/><datalist id="purchase-units"><option value="PC"/><option value="LT"/><option value="UN"/><option value="KG"/><option value="SV"/></datalist></Field></div>
  <Field label="Aplicação / local"><textarea maxLength={1000} rows={2} value={input.application} onChange={e=>patch({application:e.target.value})}/></Field>
  <div className="purchase-fleet-picker"><strong>Veículos e equipamentos</strong><input aria-label="Buscar veículo ou equipamento" placeholder="Buscar nº de frota, marca ou modelo…" value={vehicleSearch} onChange={e=>setVehicleSearch(e.target.value)}/><div>{shownVehicles.map(v=><label key={v.id}><input type="checkbox" checked={input.vehicleIds.includes(v.id)} onChange={e=>patch({vehicleIds:e.target.checked?[...input.vehicleIds,v.id]:input.vehicleIds.filter(id=>id!==v.id)})}/><span><strong>{v.internalCode}</strong> · {v.brand} {v.model}{v.partnerName?` · ${v.partnerName}`:''}</span></label>)}{!shownVehicles.length&&<p>Nenhum veículo encontrado.</p>}</div></div>
  <Field label="Observações"><textarea rows={3} maxLength={3000} value={input.notes} onChange={e=>patch({notes:e.target.value})}/></Field><label className="purchase-urgent-choice"><input type="checkbox" checked={input.urgent} onChange={e=>patch({urgent:e.target.checked})}/>Pedido urgente</label>
 </fieldset>{error&&<p role="alert" className="form-error">{error}</p>}<div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn company-primary" disabled={busy} type="submit">{busy?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>}Salvar item</button></div></form>;
}
