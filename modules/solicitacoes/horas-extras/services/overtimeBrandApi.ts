import {rpcRequest} from '@/shared/supabase/rpc';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import type {ReportCompanyBrand,ReportHeaderVariant,ReportIssuer,ReportPdfBrand} from '@/shared/reporting/types';
type DocumentBrandResponse={company:(Omit<ReportCompanyBrand,'logoUrl'>&{logoKey:string|null})|null;header:ReportHeaderVariant;watermark:{portraitImageKey:string|null;opacity:number;size:number};issuer:ReportIssuer};
async function fetchOvertimeBrand(companyId:string,signal?:AbortSignal):Promise<ReportPdfBrand>{
 const data=await rpcRequest<DocumentBrandResponse>('overtime','document-brand',{companyId},signal);
 const client=getSupabaseBrowserClient();
 const signedUrl=async(bucket:string,key:string|null)=>{
  if(!key)return null;
  const {data:signed,error}=await client.storage.from(bucket).createSignedUrl(key,3600);
  if(signal?.aborted)throw new DOMException('Consulta cancelada','AbortError');
  if(error||!signed?.signedUrl)throw new Error('Não foi possível carregar a identidade do relatório. Tente novamente.');
  return signed.signedUrl;
 };
 const [logoUrl,imageUrl]=await Promise.all([signedUrl('billing-company-logos',data.company?.logoKey??null),signedUrl('billing-watermarks',data.watermark.portraitImageKey)]);
 if(signal?.aborted)throw new DOMException('Consulta cancelada','AbortError');
 return {company:data.company?{...data.company,logoUrl}:null,header:data.header,watermark:{imageUrl,opacity:data.watermark.opacity,size:data.watermark.size},issuer:data.issuer,issuedAt:new Date()};
}
export {fetchOvertimeBrand};
