'use client';
import {useEffect, useRef, useState} from 'react';
import type {jsPDF} from 'jspdf';
import {Download, Loader2, Printer} from 'lucide-react';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from '@/components/ui/dialog';
import {useReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/hooks/useReportHeader';
import {notifications} from '@/shared/feedback';
import type {ReportOrientation, ReportPdfBrand} from './types';
import './pdfExport.css';

type PdfResult = {doc: jsPDF; fileName: string};
type ExportProps<T> = {
  snapshot: T; companyId: string; title: string; description: string; previewClassName?: string; orientation?: ReportOrientation;
  fitPreviewToWidth?: boolean; showPreviewToolbar?: boolean;
  createPdf: (snapshot: T, brand: ReportPdfBrand) => Promise<PdfResult>; onClose: () => void;
};

export function PdfExportDialog<T>(props: ExportProps<T>) {
  const orientation = props.orientation ?? 'landscape';
  const report = useReportHeader(props.companyId, orientation);
  return <Dialog open onOpenChange={open => {if (!open) props.onClose();}}><DialogContent className="form-modal pdf-export-modal"><DialogHeader><DialogTitle>{props.title}</DialogTitle><DialogDescription>{props.description}</DialogDescription></DialogHeader>
    {report.loading ? <div className="company-empty" role="status"><Loader2 className="animate-spin"/>Preparando cabeçalho…</div> : report.error || report.authRequired ? <div className="company-empty" role="alert"><p>{report.error || 'Entre para gerar o relatório.'}</p><button className="btn" onClick={() => void report.reload()}>Tentar novamente</button></div> : <PreparedPdf {...props} brand={{company:report.company, header:report.settings[orientation], watermark:report.watermark, issuer:report.issuer, issuedAt:report.issuedAt}}/>}
  </DialogContent></Dialog>;
}

function PreparedPdf<T>({snapshot, createPdf, brand, title, previewClassName = '', orientation = 'landscape', fitPreviewToWidth = false, showPreviewToolbar = false}: ExportProps<T> & {brand: ReportPdfBrand}) {
  const [snapshotBrand] = useState(brand), [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<(PdfResult & {url: string}) | null>(null), [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const printUrls = useRef<string[]>([]);
  const mounted = useRef(true), pendingPrint = useRef<Window | null>(null);
  useEffect(() => {
    let active = true, url: string | undefined;
    createPdf(snapshot, snapshotBrand).then(pdf => {
      if (active) {url = URL.createObjectURL(pdf.doc.output('blob')); setResult({...pdf, url});}
    }).catch(reason => {if (active) setError((reason as Error).message || 'Não foi possível gerar o PDF.');});
    return () => {active = false; if (url) URL.revokeObjectURL(url);};
  }, [snapshot, snapshotBrand, createPdf, attempt]);
  useEffect(() => {
    mounted.current = true;
    const urls = printUrls.current;
    return () => {mounted.current = false; pendingPrint.current?.close(); urls.forEach(url => URL.revokeObjectURL(url));};
  }, []);
  function download() {
    if (!result) return;
    try {result.doc.save(result.fileName); notifications.saved('O relatório foi baixado em PDF.');}
    catch (reason) {notifications.error((reason as Error).message);}
  }
  function print() {
    if (!result || printing) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) {notifications.error('Permita pop-ups para imprimir o relatório.'); return;}
    pendingPrint.current = popup; setPrinting(true);
    // A separate document keeps the download free of automatic print actions.
    void createPdf(snapshot, snapshotBrand).then(pdf => {
      if (!mounted.current || popup.closed) {popup.close(); return;}
      pdf.doc.autoPrint();
      const url = URL.createObjectURL(pdf.doc.output('blob')); printUrls.current.push(url); popup.location.href = url;
    }).catch(reason => {popup.close(); if (mounted.current) notifications.error((reason as Error).message || 'Não foi possível imprimir o PDF.');}).finally(() => {pendingPrint.current = null; if (mounted.current) setPrinting(false);});
  }
  const previewView = fitPreviewToWidth || orientation === 'landscape' ? 'FitH' : 'Fit';
  const previewToolbar = showPreviewToolbar ? '' : '&toolbar=0';
  return <>{error ? <div className="company-empty" role="alert"><p>{error}</p><button className="btn" onClick={() => {setError(''); setAttempt(value => value + 1);}}>Tentar novamente</button></div> : result ? <iframe className={`pdf-export-preview ${previewClassName}`} title={`Prévia completa: ${title}`} src={`${result.url}#view=${previewView}${previewToolbar}`}/> : <div className="company-empty" role="status"><Loader2 className="animate-spin"/>Gerando páginas…</div>}
    <div className="pdf-export-actions"><span>A4 · {orientation === 'portrait' ? 'Retrato' : 'Paisagem'}{result ? ` · ${result.doc.getNumberOfPages()} página(s)` : ''}</span><div><button className="btn" disabled={!result || printing} onClick={print}>{printing ? <Loader2 size={16} className="animate-spin"/> : <Printer size={16}/>}Imprimir</button><button className="btn company-primary" disabled={!result} onClick={download}><Download size={16}/>Baixar PDF</button></div></div>
  </>;
}
