import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {rpcRequest,RpcError} from '@/shared/supabase/rpc';
import {fetchWorkspaceId} from '@/shared/supabase/workspace';
import type {Material,MaterialImageChange,MaterialInput,MaterialReference,MaterialReferenceInput,Quote,QuoteAddItemsInput,QuoteAddProvidersInput,QuoteAttachment,QuoteDetailsInput,QuoteFinalizeInput,QuoteFinalizeResult,QuoteInput,QuoteItemAwardInput,QuoteItemQuantityInput,QuoteItemUnawardInput,QuoteNegotiationInput,QuoteRemoveItemInput,QuoteRemoveProviderInput,QuoteStatus} from '../types';

export const MATERIAL_IMAGE_BUCKET='billing-material-images';
export const QUOTATION_ATTACHMENT_BUCKET='billing-quotation-files';

type WireReference=MaterialReference&{imageKey?:string|null;imageName?:string};
type WireMaterial=Omit<Material,'references'|'imageUrl'|'internalCode'|'categoryId'|'categoryName'>&{internalCode?:string;code?:string|null;categoryId?:string|null;categoryName?:string|null;references?:WireReference[];variants?:WireReference[];imageUrl?:string|null};
function normalizeMaterial(material:WireMaterial):Material{
 const wireReferences=material.references??material.variants??[],references=wireReferences.map(reference=>({id:reference.id,materialId:reference.materialId,brand:reference.brand??'',code:reference.code,createdAt:reference.createdAt}));
 const legacyImage=wireReferences.find(reference=>reference.imageKey);
 return {id:material.id,name:material.name,internalCode:material.internalCode??material.code??'',categoryId:material.categoryId??null,categoryName:material.categoryName??'',unit:material.unit,application:material.application??'',imageKey:material.imageKey??legacyImage?.imageKey??null,imageName:material.imageName??legacyImage?.imageName??'',imageUrl:null,references,createdAt:material.createdAt};
}
async function withMaterialImageUrls(materials:Material[],signal?:AbortSignal){
 const normalized=materials.map(normalizeMaterial);const paths=[...new Set(normalized.map(item=>item.imageKey).filter((key):key is string=>!!key))];
 if(!paths.length)return normalized;
 const {data,error}=await getSupabaseBrowserClient().storage.from(MATERIAL_IMAGE_BUCKET).createSignedUrls(paths,3600);
 if(signal?.aborted)throw new DOMException('Consulta cancelada','AbortError');
 if(error)throw new Error('Não foi possível carregar as fotos dos materiais. Tente novamente.');
 const urls=new Map((data??[]).filter(item=>!item.error&&item.signedUrl).map(item=>[item.path,item.signedUrl]));
 return normalized.map(material=>({...material,imageUrl:material.imageKey?urls.get(material.imageKey)??null:null}));
}
async function withQuotationImageUrls(quote:Quote,signal?:AbortSignal){
 const paths=[...new Set(quote.items.map(item=>item.materialImageKey).filter((key):key is string=>!!key))];
 if(!paths.length)return quote;
 const {data,error}=await getSupabaseBrowserClient().storage.from(MATERIAL_IMAGE_BUCKET).createSignedUrls(paths,3600);
 if(signal?.aborted)throw new DOMException('Consulta cancelada','AbortError');
 if(error)return {...quote,items:quote.items.map(item=>({...item,materialImageUrl:null}))};
 const urls=new Map((data??[]).filter(item=>!item.error&&item.signedUrl).map(item=>[item.path,item.signedUrl]));
 return {...quote,items:quote.items.map(item=>({...item,materialImageUrl:item.materialImageKey?urls.get(item.materialImageKey)??null:null}))};
}
async function withQuotationAttachmentUrl(quote:Quote,signal?:AbortSignal){
 if(!quote.attachmentKey)return {...quote,attachmentUrl:null};
 const {data,error}=await getSupabaseBrowserClient().storage
  .from(QUOTATION_ATTACHMENT_BUCKET).createSignedUrl(quote.attachmentKey,3600);
 if(signal?.aborted)throw new DOMException('Consulta cancelada','AbortError');
 return {...quote,attachmentUrl:error?null:data.signedUrl};
}
export async function fetchMaterials(signal:AbortSignal){
 const result=await rpcRequest<{materials:Material[]}>('materials','list',{},signal);
 return {materials:await withMaterialImageUrls(result.materials,signal)};
}
export async function persistMaterial(input:MaterialInput,image?:MaterialImageChange){
 const client=getSupabaseBrowserClient();const storage=client.storage.from(MATERIAL_IMAGE_BUCKET);let uploadedKey:string|undefined;
 const payload:Record<string,unknown>={...input};
 if(image?.file){
  const {data:{session},error:authError}=await client.auth.getSession();
  if(authError||!session)throw new RpcError('Entre na sua conta para enviar a foto do material.',401);
  if(image.file.type!=='image/webp'||!image.file.size||image.file.size>3*1024*1024)throw new Error('A foto otimizada deve ser WebP e ter até 3 MB.');
  const actorId=session.user.id;const workspaceId=await fetchWorkspaceId();
  const {data:{session:current}}=await client.auth.getSession();
  if(current?.user.id!==actorId)throw new RpcError('Sua conta foi alterada. Reabra o cadastro para continuar.',401);
  uploadedKey=`${workspaceId}/materials/${crypto.randomUUID()}.webp`;
  const {error}=await storage.upload(uploadedKey,image.file,{contentType:'image/webp',upsert:false,cacheControl:'31536000'});
  if(error)throw new Error('Não foi possível enviar a foto. Verifique sua conexão e tente novamente.');
  payload.imageKey=uploadedKey;payload.imageName=image.file.name;
 }else if(image?.remove){payload.removeImage=true;}
 try{
  const result=await rpcRequest<{material:Material;previousImageKey:string|null}>('materials','save',payload);
  const obsolete=result.previousImageKey??image?.previousKey;
  if(obsolete&&obsolete!==uploadedKey&&(image?.remove||uploadedKey))void storage.remove([obsolete]);
  return (await withMaterialImageUrls([result.material]))[0];
 }catch(error){
  if(uploadedKey&&error instanceof RpcError&&error.status<500)void storage.remove([uploadedKey]);
  throw error;
 }
}
export async function persistMaterialReference(input:MaterialReferenceInput){
 return (await rpcRequest<{reference:MaterialReference}>('material-variants','save',input)).reference;
}
export async function deleteMaterial(id:string){
 const result=await rpcRequest<{id:string;deleted:true;imageKeys:string[]}>('materials','delete',{id});
 if(result.imageKeys?.length)void getSupabaseBrowserClient().storage.from(MATERIAL_IMAGE_BUCKET).remove(result.imageKeys);
 return result;
}
export const deleteMaterialReference=(id:string)=>rpcRequest<{id:string;deleted:true}>('material-variants','delete',{id});
export const fetchQuotes = (status: QuoteStatus, signal: AbortSignal) => rpcRequest<{quotes: Quote[]; total: number}>('quotations','list',{status},signal);
export const fetchQuote = async (id: string, signal: AbortSignal) => {
 const quote=(await rpcRequest<{quote:Quote}>('quotations','get',{id},signal)).quote;
 return withQuotationAttachmentUrl(await withQuotationImageUrls(quote,signal),signal);
};
export async function persistQuote(input:QuoteInput,attachment?:QuoteAttachment|null){
 if(!attachment)return (await rpcRequest<{quote:Quote}>('quotations','save',input)).quote;
 const {file,token}=attachment;
 if(file.type!=='application/pdf'||!file.name.toLocaleLowerCase('pt-BR').endsWith('.pdf')||!file.size||file.size>10*1024*1024){
  throw new Error('Selecione um arquivo PDF de até 10 MB.');
 }
 const client=getSupabaseBrowserClient();
 const {data:{session},error:authError}=await client.auth.getSession();
 if(authError||!session)throw new RpcError('Entre na sua conta para enviar o PDF da cotação.',401);
 const actorId=session.user.id;const workspaceId=await fetchWorkspaceId();
 const {data:{session:current}}=await client.auth.getSession();
 if(current?.user.id!==actorId)throw new RpcError('Sua conta foi alterada. Reabra a cotação para continuar.',401);
 const attachmentKey=`${workspaceId}/quotations/${token}.pdf`;
 const storage=client.storage.from(QUOTATION_ATTACHMENT_BUCKET);
 const {error:uploadError}=await storage.upload(attachmentKey,file,{contentType:'application/pdf',upsert:false,cacheControl:'3600'});
 const uploadStatus=Number((uploadError as {statusCode?:string|number}|null)?.statusCode);
 if(uploadError&&uploadStatus!==409)throw new Error('Não foi possível enviar o PDF. Verifique sua conexão e tente novamente.');
 try{
  const {data:{session:latest}}=await client.auth.getSession();
  if(latest?.user.id!==actorId)throw new RpcError('Sua conta foi alterada. Reabra a cotação para continuar.',401);
  return (await rpcRequest<{quote:Quote}>('quotations','save',{
   ...input,attachmentKey,attachmentName:file.name,attachmentSize:file.size,
  })).quote;
 }catch(error){
  if(error instanceof RpcError&&error.status<500)void storage.remove([attachmentKey]);
  throw error;
 }
}
export const updateQuoteDetails = async (input: QuoteDetailsInput) => (await rpcRequest<{quote: Quote}>('quotations','update-details',input)).quote;
export const recordQuoteNegotiation = async (input: QuoteNegotiationInput) => (await rpcRequest<{quote: Quote}>('quotations','record-negotiation',input)).quote;
export const awardQuoteItem = async (input: QuoteItemAwardInput) => (await rpcRequest<{quote: Quote}>('quotations','award-item',input)).quote;
export const unawardQuoteItem = async (input: QuoteItemUnawardInput) => (await rpcRequest<{quote: Quote}>('quotations','unaward-item',input)).quote;
export const addQuoteItems = async (input: QuoteAddItemsInput) => (await rpcRequest<{quote: Quote}>('quotations','add-items',input)).quote;
export const addQuoteProviders = async (input: QuoteAddProvidersInput) => (await rpcRequest<{quote: Quote}>('quotations','add-providers',input)).quote;
export const removeQuoteItem = async (input: QuoteRemoveItemInput) => (await rpcRequest<{quote: Quote}>('quotations','remove-item',input)).quote;
export const updateQuoteItemQuantity = async (input: QuoteItemQuantityInput) => (await rpcRequest<{quote: Quote}>('quotations','update-item-quantity',input)).quote;
export const removeQuoteProvider = async (input: QuoteRemoveProviderInput) => (await rpcRequest<{quote: Quote}>('quotations','remove-provider',input)).quote;
export const finalizeQuote = (input:QuoteFinalizeInput) => rpcRequest<QuoteFinalizeResult>('quotations','finalize',input);
export async function deleteQuote(id:string){
 const result=await rpcRequest<{id:string;deleted:true;attachmentKey:string|null}>('quotations','delete',{id});
 if(result.attachmentKey)void getSupabaseBrowserClient().storage.from(QUOTATION_ATTACHMENT_BUCKET).remove([result.attachmentKey]);
 return result;
}
