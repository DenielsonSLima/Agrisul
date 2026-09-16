import Link from 'next/link';
import {useState} from 'react';
import {Download,FileText,Loader2,Printer,RefreshCw} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {notifications} from '@/shared/feedback';
import {ReportDocument} from '@/shared/reporting';
import {activeReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/types';
import {useReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/hooks/useReportHeader';
import type {FarmPortfolioSummary,FarmSummary} from '../types';
import {formatHectares} from '../utils/farmFormat';
import {downloadFarmSummaryPdf,printFarmSummaryPdf,type FarmReportBrand} from '../reporting/farmSummaryPdf';

export function FarmReportDialog({open,onOpenChange,farms,summary}:{open:boolean;onOpenChange:(open:boolean)=>void;farms:FarmSummary[];summary:FarmPortfolioSummary}){
 const report=useReportHeader();const [action,setAction]=useState<'download'|'print'|null>(null);
 const brand:FarmReportBrand={orientation:report.settings.orientation,header:activeReportHeader(report.settings),company:report.company,watermark:report.watermark,issuer:report.issuer,issuedAt:report.issuedAt};
 const freshBrand=async():Promise<FarmReportBrand>=>({...brand,watermark:await report.refreshWatermark(),issuedAt:new Date()});
 const runDownload=async()=>{setAction('download');try{await downloadFarmSummaryPdf(farms,summary,await freshBrand());notifications.saved('O resumo geral foi baixado em PDF.');}catch(error){notifications.error((error as Error).message||'Não foi possível gerar o PDF.');}finally{setAction(null);}};
 const runPrint=async()=>{const popup=window.open('about:blank','_blank');if(!popup){notifications.error('Permita pop-ups para imprimir o relatório.');return;}popup.document.title='Preparando impressão…';setAction('print');try{await printFarmSummaryPdf(farms,summary,await freshBrand(),popup);}catch(error){popup.close();notifications.error((error as Error).message||'Não foi possível preparar a impressão.');}finally{setAction(null);}};
 return <Dialog open={open} onOpenChange={value=>{if(!action)onOpenChange(value);}}><DialogContent className="form-modal farm-report-modal" onEscapeKeyDown={event=>{if(action)event.preventDefault();}} onPointerDownOutside={event=>{if(action)event.preventDefault();}}>
  <DialogHeader><DialogTitle>Resumo geral de fazendas</DialogTitle><DialogDescription>Confira o relatório com o cabeçalho e a marca d’água configurados no sistema.</DialogDescription></DialogHeader>
  {report.loading?<div className="report-loading" role="status"><Loader2 className="animate-spin"/>Carregando identidade do relatório…</div>:report.authRequired?<div className="company-empty"><FileText/><h3>Entre para gerar o relatório</h3><p>O PDF usa as configurações da sua conta.</p><Link className="btn company-primary" href="/login?returnTo=%2Fcadastro%3Fsecao%3Dfazenda" target="_top">Entrar</Link></div>:report.error?<div className="report-load-error" role="alert"><span>{report.error}</span><button className="btn" onClick={report.reload}><RefreshCw size={15}/>Tentar novamente</button></div>:<>
   <div className="farm-report-preview-stage"><ReportDocument orientation={brand.orientation} header={brand.header} company={brand.company} watermark={brand.watermark} issuer={brand.issuer} issuedAt={brand.issuedAt} title="Resumo geral de fazendas">
    <div className="farm-report-body">
     <div className="farm-report-totals"><span><small>Fazendas</small><strong>{summary.farmCount}</strong></span><span><small>Talhões</small><strong>{summary.plotCount}</strong></span><span><small>Área total</small><strong>{formatHectares(summary.totalHa)} ha</strong></span><span><small>Área usada</small><strong>{formatHectares(summary.usedHa)} ha</strong></span><span className="preserved"><small>Preservada</small><strong>{formatHectares(summary.preservedHa)} ha</strong></span></div>
     <table><thead><tr><th>Fazenda</th><th>Localização</th><th>Talhões</th><th>Total</th><th>Usada</th><th>Preservada</th></tr></thead><tbody>{farms.slice(0,brand.orientation==='portrait'?18:10).map(farm=><tr key={farm.id}><td>{farm.name}</td><td>{farm.city} / {farm.state}</td><td>{farm.plotCount}</td><td>{formatHectares(farm.totalHa)} ha</td><td>{formatHectares(farm.usedHa)} ha</td><td>{formatHectares(farm.preservedHa)} ha</td></tr>)}</tbody></table>
     {farms.length>(brand.orientation==='portrait'?18:10)&&<p className="farm-report-more">O PDF completo incluirá todas as {farms.length} fazendas.</p>}
    </div>
   </ReportDocument></div>
   <div className="farm-report-actions"><span>A4 · {brand.orientation==='portrait'?'Retrato':'Paisagem'} · {farms.length} fazenda{farms.length===1?'':'s'}</span><div><button className="btn" disabled={!!action} onClick={runPrint}>{action==='print'?<Loader2 className="animate-spin" size={16}/>:<Printer size={16}/>}Imprimir</button><button className="btn company-primary" disabled={!!action} onClick={runDownload}>{action==='download'?<Loader2 className="animate-spin" size={16}/>:<Download size={16}/>}Baixar PDF</button></div></div>
  </>}
 </DialogContent></Dialog>;
}
