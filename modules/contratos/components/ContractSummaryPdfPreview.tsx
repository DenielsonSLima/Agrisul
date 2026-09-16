import {memo,useEffect,useState} from 'react';
import {Loader2,RefreshCw} from 'lucide-react';
import type {BillingContract} from '../types';
import {createContractMonthlySummaryPdf,type ContractMonthlyReportBrand} from '../reporting/contractMonthlySummaryPdf';

export const ContractSummaryPdfPreview=memo(function ContractSummaryPdfPreview({contract,brand}:{contract:BillingContract;brand:ContractMonthlyReportBrand}){
 const [retry,setRetry]=useState(0);
 const [result,setResult]=useState<{contract:BillingContract;brand:ContractMonthlyReportBrand;retry:number;url:string;error:string}|null>(null);
 useEffect(()=>{
  let cancelled=false,url='';
  createContractMonthlySummaryPdf(contract,brand).then(({doc})=>{
   if(cancelled)return;
   url=URL.createObjectURL(doc.output('blob'));
   setResult({contract,brand,retry,url,error:''});
  }).catch(error=>{if(!cancelled)setResult({contract,brand,retry,url:'',error:(error as Error).message||'Não foi possível preparar a prévia.'});});
  return()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};
 },[contract,brand,retry]);
 if(!result||result.contract!==contract||result.brand!==brand||result.retry!==retry)return <div className="report-loading" role="status"><Loader2 className="animate-spin"/>Preparando o resumo completo…</div>;
 if(result.error)return <div className="report-load-error" role="alert"><span>{result.error}</span><button type="button" className="btn" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={15}/>Tentar novamente</button></div>;
 return <iframe className="contract-summary-pdf-preview" src={result.url+'#view=FitH'} title="Prévia do PDF completo do resumo do contrato"/>;
// The header hook recreates nested objects. Equal brand values keep the PDF open
// while the dialog updates its download/print status; real data changes regenerate it.
},(previous,next)=>previous.contract===next.contract&&JSON.stringify(previous.brand)===JSON.stringify(next.brand));
