import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {rpcRequest,RpcError} from '@/shared/supabase/rpc';
import {fetchWorkspaceId} from '@/shared/supabase/workspace';
import type {Material,MaterialImageChange,MaterialInput,MaterialReference,MaterialReferenceInput,Quote,QuoteAddItemsInput,QuoteAddProvidersInput,QuoteFinalizeInput,QuoteFinalizeResult,QuoteInput,QuoteItemAwardInput,QuoteNegotiationInput,QuoteStatus} from '../types';

export const MATERIAL_IMAGE_BUCKET='billing-material-images';

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
export const fetchQuote = async (id: string, signal: AbortSignal) => (await rpcRequest<{quote: Quote}>('quotations','get',{id},signal)).quote;
export const persistQuote = async (input: QuoteInput) => (await rpcRequest<{quote: Quote}>('quotations','save',input)).quote;
export const recordQuoteNegotiation = async (input: QuoteNegotiationInput) => (await rpcRequest<{quote: Quote}>('quotations','record-negotiation',input)).quote;
export const awardQuoteItem = async (input: QuoteItemAwardInput) => (await rpcRequest<{quote: Quote}>('quotations','award-item',input)).quote;
export const addQuoteItems = async (input: QuoteAddItemsInput) => (await rpcRequest<{quote: Quote}>('quotations','add-items',input)).quote;
export const addQuoteProviders = async (input: QuoteAddProvidersInput) => (await rpcRequest<{quote: Quote}>('quotations','add-providers',input)).quote;
export const finalizeQuote = (input:QuoteFinalizeInput) => rpcRequest<QuoteFinalizeResult>('quotations','finalize',input);
export const deleteQuote = (id: string) => rpcRequest<{id: string; deleted: true}>('quotations','delete',{id});
