import Link from 'next/link';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Download,FileText,Loader2,Printer,RefreshCw} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {notifications} from '@/shared/feedback';
import {useReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/hooks/useReportHeader';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {contractsReportOrientation} from '../reporting/contractsReportPresentation';
import {createContractsPdf,type ContractsReportBrand,type ContractsReportData,type ContractsReportFilters} from '../reporting/contractsPdf';
import '../summary.css';
import '../summary-details.css';

type Props=ContractsReportData&{open:boolean;onOpenChange:(open:boolean)=>void;filters:ContractsReportFilters};
type PreparedProps={data:ContractsReportData;filters:ContractsReportFilters;brand:ContractsReportBrand;refreshWatermark:()=>Promise<ContractsReportBrand['watermark']>};
type PreparedResult={data:ContractsReportData;filters:ContractsReportFilters;attempt:number;url:string;fileName:string;pages:number;error:string};

function PreparedContractsReport({data,filters,brand,refreshWatermark}:PreparedProps){
 // Header hooks recreate objects on render. Freeze the identity of this open
 // report; its PDF bytes, issue time and signed images are shared by all actions.
 const [snapshot]=useState(()=>({brand:{...brand,issuedAt:new Date()},refreshWatermark}));
 const [attempt,setAttempt]=useState(0),[result,setResult]=useState<PreparedResult|null>(null);
 const pendingPrint=useRef<Window|null>(null);
 useEffect(()=>{
  let active=true,url='';
  const prepare=async()=>{
   const watermark=await snapshot.refreshWatermark();
   if(!active)return;
   const {doc,fileName}=await createContractsPdf(data,filters,{...snapshot.brand,watermark});
   if(!active)return;
   url=URL.createObjectURL(doc.output('blob'));
   setResult({data,filters,attempt,url,fileName,pages:doc.getNumberOfPages(),error:''});
  };
  void prepare().catch(error=>{
   if(active)setResult({data,filters,attempt,url:'',fileName:'',pages:0,error:(error as Error).message||'Não foi possível preparar o relatório.'});
  });
  return()=>{active=false;if(url)URL.revokeObjectURL(url);pendingPrint.current?.close();pendingPrint.current=null;};
 },[data,filters,snapshot,attempt]);
 const current=result?.data===data&&result.filters===filters&&result.attempt===attempt?result:null;
 const ready=!!current?.url&&!current.error;
 const download=()=>{
  if(!current?.url)return;
  try{
   const anchor=document.createElement('a');
   anchor.href=current.url;anchor.download=current.fileName;
   document.body.appendChild(anchor);anchor.click();anchor.remove();
   notifications.saved('O relatório de contratos foi baixado em PDF.');
  }catch(error){notifications.error((error as Error).message||'Não foi possível baixar o PDF.');}
 };
 const print=()=>{
  if(!current?.url)return;
  if(pendingPrint.current&&!pendingPrint.current.closed){pendingPrint.current.focus();return;}
  const popup=window.open('about:blank','_blank');
  if(!popup){notifications.error('Permita pop-ups para imprimir o relatório.');return;}
  pendingPrint.current=popup;popup.document.title=current.fileName;
  const frame=popup.document.createElement('iframe');
  frame.title='Relatório de contratos para impressão';
  frame.style.cssText='width:100%;height:100vh;border:0;display:block';
  popup.document.body.style.margin='0';
  frame.addEventListener('load',()=>{
   if(pendingPrint.current!==popup||popup.closed)return;
   pendingPrint.current=null;
   try{popup.focus();frame.contentWindow?.focus();frame.contentWindow?.print();}
   catch{notifications.error('O PDF foi aberto. Use a opção Imprimir do visualizador.');}
  },{once:true});
  // Use the exact preview/download Blob, not a second calculation or issue time.
  frame.src=current.url;popup.document.body.appendChild(frame);
 };
 return <>
  {!current?<div className="report-loading" role="status"><Loader2 className="animate-spin"/>Preparando consolidado, gráficos e contratos…</div>:current.error?<div className="report-load-error" role="alert"><span>{current.error}</span><button type="button" className="btn" onClick={()=>setAttempt(value=>value+1)}><RefreshCw size={15}/>Tentar novamente</button></div>:<iframe className="contract-summary-pdf-preview" src={current.url+'#view=FitH'} title="Prévia completa do relatório de contratos"/>}
  <div className="farm-report-actions"><span>A4 · Paisagem · {data.total} contrato{data.total===1?'':'s'}{ready?' · '+current!.pages+' página'+(current!.pages===1?'':'s'):''}</span><div><button type="button" className="btn" disabled={!ready} onClick={print}><Printer size={16}/>Imprimir</button><button type="button" className="btn company-primary" disabled={!ready} onClick={download}><Download size={16}/>Baixar PDF</button></div></div>
 </>;
}

export function ContractReportDialog({open,onOpenChange,contracts,summary,total,filters}:Props){
 const workspace=useWorkspaceCompany();
 const report=useReportHeader(workspace.activeCompanyId,contractsReportOrientation);
 const {bucket,search,from,to}=filters;
 const data=useMemo(()=>({contracts,summary,total}),[contracts,summary,total]);
 const selectedFilters=useMemo(()=>({bucket,search,from,to}),[bucket,search,from,to]);
 const brand:ContractsReportBrand={orientation:contractsReportOrientation,header:report.settings.landscape,company:report.company,watermark:report.watermark,issuer:report.issuer,issuedAt:report.issuedAt};
 return <Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="form-modal farm-report-modal contracts-list-report-modal">
   <DialogHeader><DialogTitle>Relatório de contratos — {bucket==='open'?'Em aberto':'Finalizado'}</DialogTitle><DialogDescription>Consolidado, gráficos comparativos e detalhamento operacional e financeiro dos contratos filtrados.</DialogDescription></DialogHeader>
   {report.loading?<div className="report-loading" role="status"><Loader2 className="animate-spin"/>Carregando identidade do relatório…</div>:report.authRequired?<div className="company-empty"><FileText/><h3>Entre para gerar o relatório</h3><p>O PDF usa as configurações da sua conta.</p><Link className="btn company-primary" href="/login?returnTo=%2Fcontratos" target="_top">Entrar</Link></div>:report.error?<div className="report-load-error" role="alert"><span>{report.error}</span><button type="button" className="btn" onClick={()=>void report.reload()}><RefreshCw size={15}/>Tentar novamente</button></div>:open?<PreparedContractsReport key={workspace.activeCompanyId+':'+report.issuer.id} data={data} filters={selectedFilters} brand={brand} refreshWatermark={report.refreshWatermark}/>:null}
  </DialogContent>
 </Dialog>;
}
