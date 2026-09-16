import {useEffect,useState} from 'react';
import {Download,Loader2,Printer} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {notifications} from '@/shared/feedback';
import {useReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/hooks/useReportHeader';
import type {BillingContract} from '../types';
import type {ContractsReportBrand} from '../reporting/contractsPdf';
import {contractTabReportOrientation,createContractTabPdf,type ContractTabReport} from '../reporting/contractTabPdf';

export function ContractTabReportDialog({contract,model,onClose}:{contract:BillingContract;model:ContractTabReport;onClose:()=>void}){
 const report=useReportHeader(contract.companyId,contractTabReportOrientation);
 const brand:ContractsReportBrand={orientation:contractTabReportOrientation,header:report.settings.landscape,company:report.company,watermark:report.watermark,issuer:report.issuer,issuedAt:report.issuedAt};
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="form-modal contract-tab-report-modal"><DialogHeader><DialogTitle>{model.title}</DialogTitle><DialogDescription>{model.criteria}. Confira todas as páginas antes de baixar ou imprimir.</DialogDescription></DialogHeader>
  {report.loading?<div className="loads-empty" role="status"><Loader2 className="animate-spin"/>Preparando relatório…</div>:report.error||report.authRequired?<div className="loads-empty" role="alert"><p>{report.error||'Entre para gerar o relatório.'}</p><button className="btn" onClick={()=>void report.reload()}>Tentar novamente</button></div>:<PreparedReport key={brand.orientation} contract={contract} model={model} brand={brand}/>}
 </DialogContent></Dialog>;
}
function PreparedReport({contract,model,brand}:{contract:BillingContract;model:ContractTabReport;brand:ContractsReportBrand}){
 const [snapshotBrand]=useState(brand),[attempt,setAttempt]=useState(0);
 const [result,setResult]=useState<(Awaited<ReturnType<typeof createContractTabPdf>>&{url:string})|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true,url:string|undefined;
  createContractTabPdf(contract,model,snapshotBrand).then(pdf=>{if(active){url=URL.createObjectURL(pdf.doc.output('blob'));setResult({...pdf,url});}}).catch(reason=>{if(active)setError((reason as Error).message||'Não foi possível preparar o PDF.');});
  return()=>{active=false;if(url)URL.revokeObjectURL(url);};
 },[contract,model,snapshotBrand,attempt]);
 const download=()=>{if(!result)return;try{result.doc.save(result.fileName);notifications.saved('O relatório foi baixado com os filtros selecionados.');}catch(reason){notifications.error((reason as Error).message);}};
 const print=()=>{if(!result)return;const popup=window.open('about:blank','_blank');if(!popup){notifications.error('Permita pop-ups para imprimir o relatório.');return;}try{result.doc.autoPrint();popup.location.href=String(result.doc.output('bloburl'));}catch(reason){popup.close();notifications.error((reason as Error).message);}};
 return <>{error?<div className="loads-empty" role="alert"><p>{error}</p><button className="btn" onClick={()=>{setError('');setAttempt(value=>value+1);}}>Tentar novamente</button></div>:!result?<div className="loads-empty" role="status"><Loader2 className="animate-spin"/>Gerando todas as páginas…</div>:<div className="contract-tab-pdf-preview" data-pdf-url={result.url}>
   <iframe title={`Prévia completa: ${model.title}`} src={`${result.url}#view=FitH&toolbar=0&navpanes=0`}/>
  </div>}
  <div className="farm-report-actions"><span>{result?`${result.doc.getNumberOfPages()} ${result.doc.getNumberOfPages()===1?'página':'páginas'} · `:''}A4 · {snapshotBrand.orientation==='portrait'?'Retrato':'Paisagem'}</span><div><button className="btn" disabled={!result} onClick={print}><Printer size={16}/>Imprimir</button><button className="btn company-primary" disabled={!result} onClick={download}><Download size={16}/>Baixar PDF</button></div></div>
 </>;
}
