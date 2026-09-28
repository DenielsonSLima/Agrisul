import Link from 'next/link';
import {useState} from 'react';
import {Download,FileText,Loader2,Printer,RefreshCw} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {notifications} from '@/shared/feedback';
import {activeReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/types';
import {useReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/hooks/useReportHeader';
import type {BillingContract} from '../types';
import {useContractLoads} from '../hooks/useContractLoads';
import {contractSummaryDetails} from '../utils/contractSummaryDetails';
import {contractMonthlyDateFilters,filterContractMonths,type ContractMonthlyPeriod} from '../utils/contractMonthlyPeriod';
import {downloadContractMonthlySummaryPdf,printContractMonthlySummaryPdf,type ContractMonthlyReportBrand} from '../reporting/contractMonthlySummaryPdf';
import {ContractSummaryPdfPreview} from './ContractSummaryPdfPreview';
import '../summary-details.css';

export function ContractMonthlyReportDialog({open,onOpenChange,contract,period}:{open:boolean;onOpenChange:(open:boolean)=>void;contract:BillingContract;period:ContractMonthlyPeriod}){
 const report=useReportHeader(contract.companyId),summary=contractSummaryDetails(contract);
 const visibleMonths=filterContractMonths(summary.months,period);
 const dates=contractMonthlyDateFilters(period),dailyLoads=useContractLoads(contract.id,{search:'',...dates,groupBy:'day'},open);
 const [action,setAction]=useState<'download'|'print'|null>(null);
 const brand:ContractMonthlyReportBrand={orientation:report.settings.orientation,header:activeReportHeader(report.settings),company:report.company,watermark:report.watermark,issuer:report.issuer,issuedAt:report.issuedAt};
 const freshBrand=async():Promise<ContractMonthlyReportBrand>=>({...brand,watermark:await report.refreshWatermark(),issuedAt:new Date()});
 const download=async()=>{if(!dailyLoads.data)return;setAction('download');try{await downloadContractMonthlySummaryPdf(contract,await freshBrand(),period,dailyLoads.data);notifications.saved('O resumo do período selecionado foi baixado em PDF.');}catch(error){notifications.error((error as Error).message||'Não foi possível gerar o PDF.');}finally{setAction(null);}};
 const print=async()=>{if(!dailyLoads.data)return;const popup=window.open('about:blank','_blank');if(!popup){notifications.error('Permita pop-ups para imprimir o resumo do contrato.');return;}popup.document.title='Preparando impressão…';setAction('print');try{await printContractMonthlySummaryPdf(contract,await freshBrand(),popup,period,dailyLoads.data);}catch(error){popup.close();notifications.error((error as Error).message||'Não foi possível preparar a impressão.');}finally{setAction(null);}};
 let content;
 if(report.loading||dailyLoads.loading)content=<div className="report-loading" role="status"><Loader2 className="animate-spin"/>{report.loading?'Carregando identidade do relatório…':'Carregando a evolução diária do período…'}</div>;
 else if(report.authRequired)content=<div className="company-empty"><FileText/><h3>Entre para gerar o relatório</h3><p>O PDF usa as configurações da sua conta.</p><Link className="btn company-primary" href="/login?returnTo=%2Fcontratos" target="_top">Entrar</Link></div>;
 else if(report.error||dailyLoads.error)content=<div className="report-load-error" role="alert"><span>{report.error||dailyLoads.error}</span><button className="btn" onClick={()=>{if(report.error)report.reload();if(dailyLoads.error)void dailyLoads.reload();}}><RefreshCw size={15}/>Tentar novamente</button></div>;
 else if(dailyLoads.data)content=<>
  <ContractSummaryPdfPreview contract={contract} brand={brand} period={period} dailyLoads={dailyLoads.data}/>
  <div className="farm-report-actions"><span>A4 · {brand.orientation==='portrait'?'Retrato':'Paisagem'} · {visibleMonths.length} {visibleMonths.length===1?'mês':'meses'} no filtro</span><div><button className="btn" disabled={!!action} onClick={print}>{action==='print'?<Loader2 className="animate-spin" size={16}/>:<Printer size={16}/>}Imprimir</button><button className="btn company-primary" disabled={!!action} onClick={download}>{action==='download'?<Loader2 className="animate-spin" size={16}/>:<Download size={16}/>}Baixar PDF</button></div></div>
 </>;
 return <Dialog open={open} onOpenChange={value=>{if(!action)onOpenChange(value);}}><DialogContent className="form-modal farm-report-modal contract-monthly-report-modal" onEscapeKeyDown={event=>{if(action)event.preventDefault();}} onPointerDownOutside={event=>{if(action)event.preventDefault();}}>
  <DialogHeader><DialogTitle>Resumo do contrato — {contract.clientName}</DialogTitle><DialogDescription>Visão operacional, evolução diária, gráficos mensais, faturamento, acordos de desconto, adiantamentos, recebimentos e saldos do contrato.</DialogDescription></DialogHeader>
  {content}
 </DialogContent></Dialog>;
}
