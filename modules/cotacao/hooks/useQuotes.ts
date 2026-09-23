import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {fetchSignatures} from '@/modules/cadastro/assinaturas/services/signatureApi';
import {addQuoteItems,addQuoteProviders,awardQuoteItem,deleteMaterial,deleteMaterialReference,deleteQuote,fetchMaterials,fetchQuote,fetchQuotes,finalizeQuote,persistMaterial,persistMaterialReference,persistQuote,recordQuoteNegotiation} from '../services/quoteApi';
import type {MaterialImageChange,MaterialInput,MaterialReferenceInput,QuoteAddItemsInput,QuoteAddProvidersInput,QuoteFinalizeInput,QuoteInput,QuoteItemAwardInput,QuoteNegotiationInput,QuoteStatus} from '../types';

export function useMaterials(){
 const query=useCadastroQuery('materials',{view:'list'},fetchMaterials);
 return {...query,materials:query.data?.materials??[]};
}
export function useQuotationRequesters(){
 const query=useCadastroQuery('signatures',{view:'quotation-requesters'},signal=>fetchSignatures({search:'',page:1,pageSize:100,status:'active'},signal));
 return {...query,requesters:(query.data?.items??[]).filter(signature=>signature.role==='requester')};
}
export function useMaterialMutations(){
 const save=useCadastroMutation('materials',({input,image}:{input:MaterialInput;image?:MaterialImageChange})=>persistMaterial(input,image));const remove=useCadastroMutation('materials',deleteMaterial);
 const saveReference=useCadastroMutation('materials',persistMaterialReference),removeReference=useCadastroMutation('materials',deleteMaterialReference);
 return {save:(input:MaterialInput,image?:MaterialImageChange)=>save.mutateAsync({input,image}),remove:(id:string)=>remove.mutateAsync(id),saveReference:(input:MaterialReferenceInput)=>saveReference.mutateAsync(input),removeReference:(id:string)=>removeReference.mutateAsync(id),saving:save.isPending||remove.isPending||saveReference.isPending||removeReference.isPending};
}
export function useQuotes(status: QuoteStatus){
 const list=useCadastroQuery('quotations',{view:'list',status},signal=>fetchQuotes(status,signal));
 return {...list,quotes:list.data?.quotes??[],total:list.data?.total??0};
}
export function useQuoteDetail(id: string | null){
 const query=useCadastroQuery('quotations',{view:'detail',id},signal=>fetchQuote(id!,signal),!!id);
 return {...query,quote:query.data??null};
}
export function useQuoteMutations(){
 const save=useCadastroMutation('quotations',persistQuote);const negotiate=useCadastroMutation('quotations',recordQuoteNegotiation);const award=useCadastroMutation('quotations',awardQuoteItem);const addItems=useCadastroMutation('quotations',addQuoteItems);const addProviders=useCadastroMutation('quotations',addQuoteProviders);const finalize=useCadastroMutation('quotations',finalizeQuote,['purchase-orders']);const remove=useCadastroMutation('quotations',deleteQuote);
 const scopeSaving=addItems.isPending||addProviders.isPending;
 return {save:(input:QuoteInput)=>save.mutateAsync(input),recordNegotiation:(input:QuoteNegotiationInput)=>negotiate.mutateAsync(input),approveItem:(input:QuoteItemAwardInput)=>award.mutateAsync(input),addItems:(input:QuoteAddItemsInput)=>addItems.mutateAsync(input),addProviders:(input:QuoteAddProvidersInput)=>addProviders.mutateAsync(input),finalize:(input:QuoteFinalizeInput)=>finalize.mutateAsync(input),remove:(id:string)=>remove.mutateAsync(id),saving:save.isPending||negotiate.isPending||award.isPending||scopeSaving||finalize.isPending||remove.isPending,negotiating:negotiate.isPending,awarding:award.isPending,scopeSaving,finalizing:finalize.isPending};
}
