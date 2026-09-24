'use client';
import {useEffect, useRef, useState} from 'react';
import type {jsPDF} from 'jspdf';
import {Download, Loader2, Printer} from 'lucide-react';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from '@/components/ui/dialog';
import {useReportHeader} from '@/modules/configuracoes/cabecalho-relatorios/hooks/useReportHeader';
import {notifications} from '@/shared/feedback';
import type {ReportOrientation, ReportPdfBrand} from './types';
import './pdfExport.css';

type PdfDocumentResult = {doc: jsPDF; fileName: string};
type PdfBinaryResult = {blob: Blob; printBlob?: Blob; fileName: string; pageCount: number};
type PdfResult = PdfDocumentResult | PdfBinaryResult;
type PdfCreateOptions = {autoPrint?: boolean; signal?: AbortSignal};
type ExportProps<T> = {
  snapshot: T; companyId: string; title: string; description: string; previewClassName?: string; orientation?: ReportOrientation;
  fitPreviewToWidth?: boolean; showPreviewToolbar?: boolean;
  createPdf: (snapshot: T, brand: ReportPdfBrand, options?: PdfCreateOptions) => Promise<PdfResult>; onClose: () => void;
};

type PreparedResult = {fileName: string; pageCount: number; url: string; printBlob?: Blob};

function pdfBlob(result: PdfResult) {
  return 'blob' in result ? result.blob : result.doc.output('blob');
}

function pageCount(result: PdfResult) {
  return 'pageCount' in result ? result.pageCount : result.doc.getNumberOfPages();
}

export function PdfExportDialog<T>(props: ExportProps<T>) {
  const orientation = props.orientation ?? 'landscape';
  const report = useReportHeader(props.companyId, orientation);
  return <Dialog open onOpenChange={open => {if (!open) props.onClose();}}><DialogContent className="form-modal pdf-export-modal"><DialogHeader><DialogTitle>{props.title}</DialogTitle><DialogDescription>{props.description}</DialogDescription></DialogHeader>
    {report.loading ? <div className="company-empty" role="status"><Loader2 className="animate-spin"/>Preparando cabeçalho…</div> : report.error || report.authRequired ? <div className="company-empty" role="alert"><p>{report.error || 'Entre para gerar o relatório.'}</p><button className="btn" onClick={() => void report.reload()}>Tentar novamente</button></div> : <PreparedPdf {...props} brand={{company:report.company, header:report.settings[orientation], watermark:report.watermark, issuer:report.issuer, issuedAt:report.issuedAt}}/>}
  </DialogContent></Dialog>;
}

function PreparedPdf<T>({snapshot, createPdf, brand, title, previewClassName = '', orientation = 'landscape', fitPreviewToWidth = false, showPreviewToolbar = false}: ExportProps<T> & {brand: ReportPdfBrand}) {
  const [snapshotBrand] = useState(brand), [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<PreparedResult | null>(null), [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const printUrls = useRef<string[]>([]);
  const mounted = useRef(true), pendingPrint = useRef<Window | null>(null), printInProgress = useRef(false);
  useEffect(() => {
    let active = true, url: string | undefined;
    const controller = new AbortController();
    createPdf(snapshot, snapshotBrand, {signal: controller.signal}).then(pdf => {
      if (active) {
        url = URL.createObjectURL(pdfBlob(pdf));
        setResult({
          fileName: pdf.fileName,
          pageCount: pageCount(pdf),
          url,
          printBlob: 'printBlob' in pdf ? pdf.printBlob : undefined,
        });
      }
    }).catch(reason => {
      if (active && (reason as Error).name !== 'AbortError') {
        setError((reason as Error).message || 'Não foi possível gerar o PDF.');
      }
    });
    return () => {active = false; controller.abort(); if (url) URL.revokeObjectURL(url);};
  }, [snapshot, snapshotBrand, createPdf, attempt]);
  useEffect(() => {
    mounted.current = true;
    const urls = printUrls.current;
    return () => {mounted.current = false; pendingPrint.current?.close(); urls.forEach(url => URL.revokeObjectURL(url));};
  }, []);
  function download() {
    if (!result) return;
    try {
      const anchor = document.createElement('a');
      anchor.href = result.url; anchor.download = result.fileName; anchor.click();
      notifications.saved('O relatório foi baixado em PDF.');
    }
    catch (reason) {notifications.error((reason as Error).message);}
  }
  function print() {
    if (!result || printing || printInProgress.current) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) {notifications.error('Permita pop-ups para imprimir o relatório.'); return;}
    printInProgress.current = true; pendingPrint.current = popup; setPrinting(true);
    if (result.printBlob) {
      const url = URL.createObjectURL(result.printBlob);
      printUrls.current.push(url); popup.location.href = url;
      printInProgress.current = false; pendingPrint.current = null; setPrinting(false);
      return;
    }
    // A separate document keeps the download free of automatic print actions.
    void createPdf(snapshot, snapshotBrand, {autoPrint: true}).then(pdf => {
      if (!mounted.current || popup.closed) {popup.close(); return;}
      if ('doc' in pdf) pdf.doc.autoPrint();
      const url = URL.createObjectURL(pdfBlob(pdf)); printUrls.current.push(url); popup.location.href = url;
    }).catch(reason => {popup.close(); if (mounted.current) notifications.error((reason as Error).message || 'Não foi possível imprimir o PDF.');}).finally(() => {
      printInProgress.current = false; pendingPrint.current = null; if (mounted.current) setPrinting(false);
    });
  }
  const previewView = fitPreviewToWidth || orientation === 'landscape' ? 'FitH' : 'Fit';
  const previewToolbar = showPreviewToolbar ? '' : '&toolbar=0';
  return <>{error ? <div className="company-empty" role="alert"><p>{error}</p><button className="btn" onClick={() => {setError(''); setAttempt(value => value + 1);}}>Tentar novamente</button></div> : result ? <iframe className={`pdf-export-preview ${previewClassName}`} title={`Prévia completa: ${title}`} src={`${result.url}#view=${previewView}${previewToolbar}`}/> : <div className="company-empty" role="status"><Loader2 className="animate-spin"/>Gerando páginas…</div>}
    <div className="pdf-export-actions"><span>A4 · {orientation === 'portrait' ? 'Retrato' : 'Paisagem'}{result ? ` · ${result.pageCount} página(s)` : ''}</span><div><button className="btn" disabled={!result || printing} onClick={print}>{printing ? <Loader2 size={16} className="animate-spin"/> : <Printer size={16}/>}Imprimir</button><button className="btn company-primary" disabled={!result} onClick={download}><Download size={16}/>Baixar PDF</button></div></div>
  </>;
}
