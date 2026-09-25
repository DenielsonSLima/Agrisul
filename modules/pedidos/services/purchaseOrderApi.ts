import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {rpcRequest} from '@/shared/supabase/rpc';
import type {PurchaseOrder,PurchaseOrderCollection,PurchaseOrderFilters,PurchaseOrderInput,PurchaseOrderItem,PurchaseOrderReference} from '../types';

const MATERIAL_IMAGE_BUCKET='billing-material-images';

type WireReference = Partial<PurchaseOrderReference>;
type WireItem = Partial<Omit<PurchaseOrderItem,'materialReferences'|'materialImageUrl'>> & {materialReferences?:WireReference[];total?:string|number|null};
type WireOrder = Partial<Omit<PurchaseOrder,'items'|'providerEmail'|'providerPhone'|'providerContactId'>> & {
  items?:WireItem[];
  providerEmail?:string|null;
  providerPhone?:string|null;
  providerContactId?:string|null;
  providerContact?:{id?:string|null;name?:string|null;phone?:string|null}|null;
  quotationRequestDate?:string|null;
  provider?:{legalName?:string|null;name?:string|null;email?:string|null;phone?:string|null}|null;
  contacts?:{email?:string|null;phone?:string|null}|null;
};

const text=(value:unknown)=>value===null||value===undefined?'':String(value);
const normalizeReference=(reference:WireReference):PurchaseOrderReference=>({brand:text(reference.brand),code:text(reference.code)});
const normalizeItem=(item:WireItem,index:number):PurchaseOrderItem=>({
  id:text(item.id)||`item-${index}`,
  quotationItemId:text(item.quotationItemId),
  materialId:text(item.materialId),
  materialName:text(item.materialName),
  materialInternalCode:text(item.materialInternalCode),
  materialApplication:text(item.materialApplication),
  materialReferences:(item.materialReferences??[]).map(normalizeReference),
  materialImageKey:text(item.materialImageKey)||null,
  materialImageName:text(item.materialImageName),
  materialImageUrl:null,
  quantity:text(item.quantity),
  unit:text(item.unit),
  unitPrice:text(item.unitPrice),
  lineTotal:text(item.lineTotal??item.total),
  notes:text(item.notes),
});
const normalizeOrder=(order:WireOrder):PurchaseOrder=>({
  id:text(order.id),
  number:text(order.number),
  status:order.status==='finished'?'finished':'open',
  quotationId:text(order.quotationId),
  quotationNumber:text(order.quotationNumber),
  quotationTitle:text(order.quotationTitle),
  quotationRequester:text(order.quotationRequester),
  quotationNotes:text(order.quotationNotes),
  providerId:text(order.providerId),
  providerName:text(order.providerName??order.provider?.legalName??order.provider?.name),
  providerLegalName:text(order.providerLegalName??order.providerName??order.provider?.legalName??order.provider?.name),
  providerTradeName:text(order.providerTradeName),
  providerDocumentType:order.providerDocumentType==='CPF'?'CPF':order.providerDocumentType==='CNPJ'?'CNPJ':'',
  providerDocument:text(order.providerDocument),
  providerAddress:text(order.providerAddress),
  providerEmail:text(order.providerEmail??order.provider?.email??order.contacts?.email),
  providerPhone:text(order.providerPhone??order.provider?.phone??order.contacts?.phone),
  providerContactId:text(order.providerContactId??order.providerContact?.id)||null,
  providerContactName:text(order.providerContactName??order.providerContact?.name),
  providerContactPhone:text(order.providerContactPhone??order.providerContact?.phone),
  requestDate:text(order.requestDate??order.quotationRequestDate),
  createdAt:text(order.createdAt),
  paymentMethod:text(order.paymentMethod),
  paymentMethodId:text(order.paymentMethodId)||null,
  purchaseOrderNumber:text(order.purchaseOrderNumber),
  total:text(order.total),
  itemCount:Number(order.itemCount??order.items?.length??0),
  items:(order.items??[]).map(normalizeItem),
  finishedAt:text(order.finishedAt)||null,
  updatedAt:text(order.updatedAt),
});

async function withItemImageUrls(order:PurchaseOrder,signal:AbortSignal){
  const paths=[...new Set(order.items.map(item=>item.materialImageKey).filter((path):path is string=>!!path))];
  if(!paths.length)return order;
  const {data,error}=await getSupabaseBrowserClient().storage.from(MATERIAL_IMAGE_BUCKET).createSignedUrls(paths,3600);
  if(signal.aborted)throw new DOMException('Consulta cancelada','AbortError');
  if(error)throw new Error('Não foi possível carregar as fotos dos itens. Tente novamente.');
  const urls=new Map((data??[]).filter(item=>!item.error&&item.signedUrl).map(item=>[item.path,item.signedUrl]));
  return {...order,items:order.items.map(item=>({...item,materialImageUrl:item.materialImageKey?urls.get(item.materialImageKey)??null:null}))};
}

export async function fetchPurchaseOrders(filters:PurchaseOrderFilters,signal:AbortSignal):Promise<PurchaseOrderCollection>{
  const result=await rpcRequest<{orders:WireOrder[];total:number;counts?:{open?:number;finished?:number}}>('purchase-orders','list',filters,signal);
  return {orders:(result.orders??[]).map(normalizeOrder),total:Number(result.total??result.orders?.length??0),counts:{open:Number(result.counts?.open??0),finished:Number(result.counts?.finished??0)}};
}

export async function fetchPurchaseOrder(id:string,signal:AbortSignal):Promise<PurchaseOrder>{
  const result=await rpcRequest<{order:WireOrder}>('purchase-orders','get',{id},signal);
  return withItemImageUrls(normalizeOrder(result.order),signal);
}

export async function persistPurchaseOrder(input:PurchaseOrderInput):Promise<PurchaseOrder>{
  const result=await rpcRequest<{order:WireOrder}>('purchase-orders','save',input);
  return normalizeOrder(result.order);
}

export async function finishPurchaseOrder(id:string):Promise<PurchaseOrder>{
  const result=await rpcRequest<{order:WireOrder}>('purchase-orders','finish',{id});
  return normalizeOrder(result.order);
}
