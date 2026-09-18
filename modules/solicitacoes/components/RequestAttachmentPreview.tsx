'use client';
/* eslint-disable @next/next/no-img-element -- Attachments use private, temporary Storage URLs. */
import {useId, useState} from 'react';
import {ExternalLink, FileText, Loader2, RefreshCw} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {useRequestFileUrl} from '../hooks/useServiceRequests';
import type {RequestFile} from '../types';
import '../attachment-preview.css';

function AttachmentContent({file}: {file: RequestFile}) {
  const url = useRequestFileUrl(file.bucket, file.path);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = url.isError || !!url.data && failedUrl === url.data;
  return <>
    <div className="request-attachment-tools"><span>{file.contentType === 'application/pdf' ? 'PDF' : 'Imagem'} · {new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1}).format(file.size / 1024)} KB</span>{url.data && <a className="btn" href={url.data} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>Abrir em nova aba</a>}</div>
    <div className="request-attachment-stage">
      {failed ? <div className="request-attachment-state" role="alert"><FileText size={28}/><strong>Não foi possível carregar o anexo.</strong><button className="btn" type="button" onClick={() => {setFailedUrl(null); void url.refetch();}}><RefreshCw size={15}/>Tentar novamente</button></div>
        : !url.data ? <div className="request-attachment-state" role="status"><Loader2 size={28} className="animate-spin"/>Carregando orçamento…</div>
        : file.contentType === 'application/pdf' ? <iframe src={`${url.data}#view=FitH&navpanes=0`} title={`Orçamento: ${file.fileName}`} onError={() => setFailedUrl(url.data!)}/>
        : <img src={url.data} alt={`Orçamento: ${file.fileName}`} onError={() => setFailedUrl(url.data!)}/>}
    </div>
  </>;
}

export function RequestAttachmentPreview({files, requestNumber, onClose, onCloseAutoFocus}: {files: RequestFile[]; requestNumber: number; onClose: () => void; onCloseAutoFocus: (event: Event) => void}) {
  const [selectedId, setSelectedId] = useState(files[0]?.id);
  const selectorId = useId();
  const selected = files.find(file => file.id === selectedId) ?? files[0];
  return <Dialog open onOpenChange={open => {if (!open) onClose();}}><DialogContent className="request-attachment-modal" onCloseAutoFocus={onCloseAutoFocus}>
    <DialogHeader><DialogTitle>Orçamentos · Solicitação nº {requestNumber}</DialogTitle><DialogDescription>Visualize os arquivos anexados a esta solicitação.</DialogDescription></DialogHeader>
    {selected ? <><div className="request-attachment-selector"><label htmlFor={selectorId}>Arquivo ({files.length})</label><select id={selectorId} value={selected.id} onChange={event => setSelectedId(event.target.value)}>{files.map(file => <option key={file.id} value={file.id}>{file.fileName}</option>)}</select></div><AttachmentContent key={selected.id} file={selected}/></> : <div className="request-attachment-state">Nenhum orçamento anexado.</div>}
  </DialogContent></Dialog>;
}
