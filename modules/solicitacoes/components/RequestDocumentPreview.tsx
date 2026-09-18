'use client';
import {useEffect, useState} from 'react';
import {Download, FileText, Loader2, RefreshCw} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {useDocumentWatermark} from '@/shared/reporting/useDocumentWatermark';
import {useRequestDocumentBrand} from '../hooks/useRequestDocumentBrand';
import type {ServiceRequest} from '../types';

type PreviewResult = {request: ServiceRequest; actorId: string; url?: string; pages?: number; error?: string};

function imageIdentity(url: string | null | undefined) {
  if (!url) return null;
  try {const image = new URL(url); return `${image.origin}${image.pathname}`;}
  catch {return url.split('?')[0];}
}

function PdfPreview({request, actorId, onRetry}: {request: ServiceRequest; actorId: string; onRetry: () => void}) {
  const [result, setResult] = useState<PreviewResult | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void import('../reporting/serviceRequestPdf').then(async ({buildServiceRequestPdf}) => {
      const document = await buildServiceRequestPdf(structuredClone(request), {actorId, signal: controller.signal});
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(document.output('blob'));
      setResult({request, actorId, url: objectUrl, pages: document.getNumberOfPages()});
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({request, actorId, error: error instanceof Error ? error.message : 'Não foi possível preparar o documento.'});
    });
    return () => {controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [request, actorId]);
  const current = result?.request === request && result.actorId === actorId ? result : null;
  return <>
    <div className="request-preview-toolbar">
      <span><FileText size={16}/>{current?.url ? `A4 retrato · ${current.pages} ${current.pages === 1 ? 'página' : 'páginas'}` : 'A4 retrato'}</span>
      <div>{current?.url && <a className="btn" href={current.url} download={`solicitacao-servico-${request.number}.pdf`}><Download size={15}/>Baixar PDF</a>}<button type="button" className="btn request-preview-refresh" onClick={onRetry} aria-label="Atualizar prévia do documento"><RefreshCw size={15}/></button></div>
    </div>
    <div className="request-preview-stage">
      {current?.error ? <div className="request-preview-state" role="alert"><FileText size={30}/><strong>Não foi possível abrir a prévia</strong><p>{current.error}</p><button type="button" className="btn" onClick={onRetry}><RefreshCw size={15}/>Tentar novamente</button></div> : current?.url ? <iframe src={`${current.url}#view=FitH&navpanes=0`} title={`PDF completo da solicitação nº ${request.number}`} className="request-preview-pdf"/> : <div className="request-preview-state" role="status"><Loader2 size={30} className="animate-spin"/><strong>Preparando o documento</strong><p>Carregando o cabeçalho, as assinaturas e todas as páginas.</p></div>}
    </div>
  </>;
}

export function RequestDocumentPreview({request, actorId, open, onClose, onCloseAutoFocus}: {request: ServiceRequest; actorId: string; open: boolean; onClose: () => void; onCloseAutoFocus: (event: Event) => void}) {
  const [revision, setRevision] = useState(0);
  const watermark = useDocumentWatermark();
  const brand = useRequestDocumentBrand();
  // Signed URL tokens refresh independently of the saved artwork. Only changes
  // to its path, identity data or presentation settings reset the PDF viewer.
  const company = brand.data?.company;
  const identity = JSON.stringify([
    {...watermark.watermark, imageUrl: imageIdentity(watermark.watermark.imageUrl)},
    brand.data ? {...brand.data, company: company ? {...company, logoUrl: imageIdentity(company.logoUrl)} : null} : null,
  ]);
  const identityLoading = watermark.loading || brand.isPending;
  const identityError = watermark.error || brand.error?.message;
  return <Dialog open={open} onOpenChange={value => {if (!value) onClose();}}>
    <DialogContent className="request-preview-modal" onCloseAutoFocus={onCloseAutoFocus}>
      <div className="request-preview-heading"><DialogTitle>Solicitação de serviço nº {request.number}</DialogTitle><DialogDescription>Confira o documento completo antes de imprimir ou baixar.</DialogDescription></div>
      {open && (identityLoading ? <div className="request-preview-stage"><div className="request-preview-state" role="status"><Loader2 size={30} className="animate-spin"/><strong>Preparando o documento</strong><p>Carregando o cabeçalho e a marca d’água.</p></div></div> : identityError ? <div className="request-preview-stage"><div className="request-preview-state" role="alert"><FileText size={30}/><strong>Não foi possível preparar o documento</strong><p>{identityError}</p><button type="button" className="btn" onClick={() => {void watermark.reload(); void brand.refetch();}}><RefreshCw size={15}/>Tentar novamente</button></div></div> : <PdfPreview key={`${revision}:${identity}`} request={request} actorId={actorId} onRetry={() => setRevision(value => value + 1)}/>) }
    </DialogContent>
  </Dialog>;
}
