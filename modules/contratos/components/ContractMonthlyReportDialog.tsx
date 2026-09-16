import Link from 'next/link';
import {useState} from 'react';
import {Download,FileText,Loader2,Printer,RefreshCw} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {notifications} from '@/shared/feedback';
import {activeReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/types';
import {useReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/hooks/useReportHeader';
import type {BillingContract} from '../types';
import {contractSummaryDetails} from '../utils/contractSummaryDetails';
import {downloadContractMonthlySummaryPdf,printContractMonthlySummaryPdf,type ContractMonthlyReportBrand} from '../reporting/contractMonthlySummaryPdf';
import {ContractSummaryPdfPreview} from './ContractSummaryPdfPreview';
import '../summary-details.css';

export function ContractMonthlyReportDialog({open,onOpenChange,contract}:{open:boolean;onOpenChange:(open:boolean)=>void;contract:BillingContract}){
 const report=useReportHeader(contract.companyId),summary=contractSummaryDetails(contract);
 const [action,setAction]=useState<'download'|'print'|null>(null);
 const brand:ContractMonthlyReportBrand={orientation:report.settings.orientation,header:activeReportHeader(report.settings),company:report.company,watermark:report.watermark,issuer:report.issuer,issuedAt:report.issuedAt};
 const freshBrand=async():Promise<ContractMonthlyReportBrand>=>({...brand,watermark:await report.refreshWatermark(),issuedAt:new Date()});
 const download=async()=>{setAction('download');try{await downloadContractMonthlySummaryPdf(contract,await freshBrand());notifications.saved('O resumo completo do contrato foi baixado em PDF.');}catch(error){notifications.error((error as Error).message||'Não foi possível gerar o PDF.');}finally{setAction(null);}};
 const print=async()=>{const popup=window.open('about:blank','_blank');if(!popup){notifications.error('Permita pop-ups para imprimir o resumo do contrato.');return;}popup.document.title='Preparando impressão…';setAction('print');try{await printContractMonthlySummaryPdf(contract,await freshBrand(),popup);}catch(error){popup.close();notifications.error((error as Error).message||'Não foi possível preparar a impressão.');}finally{setAction(null);}};
 return <Dialog open={open} onOpenChange={value=>{if(!action)onOpenChange(value);}}><DialogContent className="form-modal farm-report-modal contract-monthly-report-modal" onEscapeKeyDown={event=>{if(action)event.preventDefault();}} onPointerDownOutside={event=>{if(action)event.preventDefault();}}>
  <DialogHeader><DialogTitle>Resumo do contrato — {contract.clientName}</DialogTitle><DialogDescription>Visão operacional, gráficos mensais, faturamento, acordos de desconto, adiantamentos, recebimentos e saldos do contrato.</DialogDescription></DialogHeader>
  {report.loading?<div className="report-loading" role="status"><Loader2 className="animate-spin"/>Carregando identidade do relatório…</div>:report.authRequired?<div className="company-empty"><FileText/><h3>Entre para gerar o relatório</h3><p>O PDF usa as configurações da sua conta.</p><Link className="btn company-primary" href="/login?returnTo=%2Fcontratos" target="_top">Entrar</Link></div>:report.error?<div className="report-load-error" role="alert"><span>{report.error}</span><button className="btn" onClick={report.reload}><RefreshCw size={15}/>Tentar novamente</button></div>:<>
   <ContractSummaryPdfPreview contract={contract} brand={brand}/>
   <div className="farm-report-actions"><span>A4 · {brand.orientation==='portrait'?'Retrato':'Paisagem'} · {summary.months.length} {summary.months.length===1?'mês':'meses'}</span><div><button className="btn" disabled={!!action} onClick={print}>{action==='print'?<Loader2 className="animate-spin" size={16}/>:<Printer size={16}/>}Imprimir</button><button className="btn company-primary" disabled={!!action} onClick={download}>{action==='download'?<Loader2 className="animate-spin" size={16}/>:<Download size={16}/>}Baixar PDF</button></div></div>
  </>}
 </DialogContent></Dialog>;
}
