import Link from 'next/link';
import {useState} from 'react';
import {Download,FileText,Loader2,Printer,RefreshCw} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {ReportDocument} from '@/shared/reporting';
import {notifications} from '@/shared/feedback';
import {useReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/hooks/useReportHeader';
import {formatContractDate} from '../utils/contractFormat';
import {contractsReportNote,contractsReportOrientation} from '../reporting/contractsReportPresentation';
import {contractSummaryPendingNote} from '../utils/contractSummaryPresentation';
import {ContractsReportSummary,ContractsReportTable} from './ContractsReportTable';
import {downloadContractsPdf,printContractsPdf,type ContractsReportBrand,type ContractsReportData,type ContractsReportFilters} from '../reporting/contractsPdf';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import '../summary.css';

type Props=ContractsReportData&{open:boolean;onOpenChange:(open:boolean)=>void;filters:ContractsReportFilters};
export function ContractReportDialog({open,onOpenChange,contracts,summary,total,filters}:Props){
 const workspace=useWorkspaceCompany();const report=useReportHeader(workspace.activeCompanyId,contractsReportOrientation);
 const [action,setAction]=useState<'download'|'print'|null>(null);const {bucket,search,from,to}=filters;
 const brand:ContractsReportBrand={orientation:contractsReportOrientation,header:report.settings.landscape,company:report.company,watermark:report.watermark,issuer:report.issuer,issuedAt:report.issuedAt};
 const period=from||to?`Data do contrato: ${from?formatContractDate(from):'início'} a ${to?formatContractDate(to):'sem limite'}`:'Todos os períodos';
 const searchLabel=search?`Busca: ${search}`:'Sem filtro de busca',previewRows=3;
 const freshBrand=async():Promise<ContractsReportBrand>=>({...brand,watermark:await report.refreshWatermark(),issuedAt:new Date()});
 const download=async()=>{setAction('download');try{await downloadContractsPdf({contracts,summary,total},filters,await freshBrand());notifications.saved('O relatório de contratos foi baixado em PDF.');}catch(error){notifications.error((error as Error).message||'Não foi possível gerar o PDF.');}finally{setAction(null);}};
 const print=async()=>{const popup=window.open('about:blank','_blank');if(!popup){notifications.error('Permita pop-ups para imprimir o relatório.');return;}popup.document.title='Preparando impressão…';setAction('print');try{await printContractsPdf({contracts,summary,total},filters,await freshBrand(),popup);}catch(error){popup.close();notifications.error((error as Error).message||'Não foi possível preparar a impressão.');}finally{setAction(null);}};
 return <Dialog open={open} onOpenChange={value=>{if(!action)onOpenChange(value);}}>
  <DialogContent className="form-modal farm-report-modal contracts-list-report-modal" onEscapeKeyDown={event=>{if(action)event.preventDefault();}} onPointerDownOutside={event=>{if(action)event.preventDefault();}}>
   <DialogHeader><DialogTitle>Relatório de contratos — {bucket==='open'?'Em aberto':'Finalizado'}</DialogTitle><DialogDescription>Duas linhas por contrato: quantidades e ATR na primeira; faturamento, recebidos, adiantamentos e saldo a receber na segunda.</DialogDescription></DialogHeader>
   {report.loading?<div className="report-loading" role="status"><Loader2 className="animate-spin"/>Carregando identidade do relatório…</div>:report.authRequired?<div className="company-empty"><FileText/><h3>Entre para gerar o relatório</h3><p>O PDF usa as configurações da sua conta.</p><Link className="btn company-primary" href="/login?returnTo=%2Fcontratos" target="_top">Entrar</Link></div>:report.error?<div className="report-load-error" role="alert"><span>{report.error}</span><button className="btn" onClick={report.reload}><RefreshCw size={15}/>Tentar novamente</button></div>:<>
    <div className="farm-report-preview-stage"><ReportDocument orientation={brand.orientation} header={brand.header} company={brand.company} watermark={brand.watermark} issuer={brand.issuer} issuedAt={brand.issuedAt} title={bucket==='open'?'Contratos em aberto':'Contratos finalizados'}>
     <div className={`contract-report-body contract-list-report contract-list-report-${brand.orientation}`}>
      <p>{total} contrato{total===1?'':'s'} · {period} · {searchLabel}</p>
      <ContractsReportSummary summary={summary}/>
      {summary.billingPending&&<p className="contract-report-pending">{contractSummaryPendingNote}</p>}
      <p className="contract-report-legend">{contractsReportNote}</p>
      <ContractsReportTable contracts={contracts.slice(0,previewRows)}/>
      {!contracts.length&&<p>Nenhum contrato encontrado para os filtros selecionados.</p>}
      {contracts.length>previewRows&&<p>O PDF completo incluirá todos os registros filtrados.</p>}
     </div>
    </ReportDocument></div>
    <div className="farm-report-actions"><span>A4 · Paisagem · {total} contrato{total===1?'':'s'}</span><div><button className="btn" disabled={!!action} onClick={print}>{action==='print'?<Loader2 className="animate-spin" size={16}/>:<Printer size={16}/>}Imprimir</button><button className="btn company-primary" disabled={!!action} onClick={download}>{action==='download'?<Loader2 className="animate-spin" size={16}/>:<Download size={16}/>}Baixar PDF</button></div></div>
   </>}
  </DialogContent>
 </Dialog>;
}
