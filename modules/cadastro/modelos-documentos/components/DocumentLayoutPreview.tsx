'use client';
/* eslint-disable @next/next/no-img-element -- Signed signature images and local QR data URLs must not enter a public image optimizer. */
import {useLayoutEffect, useRef, type CSSProperties, type ReactNode} from 'react';
import {QrCode} from 'lucide-react';
import {ReportWatermark} from '@/shared/reporting/ReportWatermark';
import type {ReportWatermarkBrand} from '@/shared/reporting/types';
import {documentBlockText, documentSignatureLabel, pointsToMillimeters} from '../presentation';
import {documentFontFamilies, type DocumentBlock, type DocumentLayout, type DocumentPreviewData} from '../types';
import '../styles.css';
import type {RequestDocumentBrand} from '@/modules/solicitacoes/services/documentBrandApi';
import {isStandardServiceRequestLayout, layoutWithReportHeader} from '../reportHeaderLayout';
import {DocumentReportHeader} from './DocumentReportHeader';

export function documentBlockStyle(block: DocumentBlock, scale: number): CSSProperties {
  return {
    left: block.x * scale, top: block.y * scale, width: block.width * scale, height: block.height * scale,
    fontFamily: documentFontFamilies[block.fontFamily ?? 'sans'], fontSize: pointsToMillimeters(block.fontSize ?? (block.type === 'signature' ? 8 : 10)) * scale,
    fontWeight: block.fontWeight === 'bold' ? 700 : 400, textAlign: block.align ?? 'left',
  };
}

function BlockContent({block, data, scale}: {block: DocumentBlock; data: DocumentPreviewData; scale: number}) {
  if (block.type === 'line') return <div className="document-rule"/>;
  if (block.type === 'items') return <table className="document-items" style={{'--document-cell-padding': `${1.8 * scale}px`, '--document-cell-inline': `${2.5 * scale}px`, '--document-table-header': `${8 * scale}px`} as CSSProperties}>
    <thead><tr><th>Equipamento / material / serviço</th><th>Aplicação</th></tr></thead>
    <tbody>{data.items.length ? data.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{item.application}</td></tr>) : <tr><td>Descrição do serviço</td><td>Equipamento / aplicação</td></tr>}</tbody>
  </table>;
  if (block.type === 'signature') {
    const role = block.field === 'director' ? 'director' : 'requester';
    const signature = data.signatures[role];
    const nameStep = pointsToMillimeters(block.fontSize ?? 8) * 1.25;
    return <div className="document-signature" style={{'--signature-name-step': `${nameStep * scale}px`, '--signature-copy-top': `${(24 - nameStep * .8) * scale}px`, '--signature-time-gap': `${(nameStep - 3) * .8 * scale}px`, '--signature-hash-gap': `${((signature?.timestamp ? 3 : nameStep) - 2.6) * .8 * scale}px`} as CSSProperties}>
      <strong className="document-signature-label">{documentSignatureLabel(role)}</strong>
      <div className="document-signature-ink">{signature?.imageUrl ? <img src={signature.imageUrl} alt={`Assinatura de ${signature.name}`}/> : <span>{role === 'director' && data.fields.status === 'Pendente' ? 'Aguardando aprovação' : 'Assinatura manual'}</span>}</div>
      <div className="document-signature-line"/>
      <div className="document-signature-copy"><div className="document-signature-name">{signature?.name || '\u00a0'}</div>
        {signature?.timestamp && <div className="document-signature-time">{signature.timestamp} · Brasília</div>}
        {signature?.hash && <div className="document-signature-hash">Hash do registro: {signature.hash}</div>}
      </div>
    </div>;
  }
  if (block.type === 'verification') return <div className="document-verification" style={{gap: 3 * scale}}>
    <div className="document-verification-qr" style={{width: block.height * scale, height: block.height * scale}}>{data.verification?.qrImageUrl ? <img src={data.verification.qrImageUrl} alt="QR para conferir o registro do documento"/> : <><QrCode/><span>QR do documento</span></>}</div>
    <div className="document-verification-text"><strong>CONFERÊNCIA DO DOCUMENTO</strong><span>Escaneie o QR code para conferir o registro no sistema.</span><small>Hash do documento</small><code>{data.verification?.code ?? data.fields.verificationCode ?? '—'}</code></div>
  </div>;
  return <div className="document-text">{documentBlockText(block, data)}</div>;
}

export function DocumentLayoutPreview({layout: sourceLayout, data, scale = 3, children, onOverflow, className = '', watermark, brand}: {
  layout: DocumentLayout; data: DocumentPreviewData; scale?: number; children?: ReactNode;
  watermark?: ReportWatermarkBrand;
  brand?: RequestDocumentBrand;
  onOverflow?: (ids: string[]) => void; className?: string;
}) {
  const layout = layoutWithReportHeader(sourceLayout);
  const standard = isStandardServiceRequestLayout(layout);
  const page = useRef<HTMLDivElement>(null);
  const previousOverflow = useRef('');
  useLayoutEffect(() => {
    if (!onOverflow || !page.current) return;
    const element = page.current;
    const check = () => {
      const ids = [...element.querySelectorAll<HTMLElement>('[data-document-block]')]
        .filter(block => block.scrollHeight > block.clientHeight + 2 || block.scrollWidth > block.clientWidth + 2)
        .map(block => block.dataset.documentBlock!);
      const value = ids.join(',');
      if (value !== previousOverflow.current) {previousOverflow.current = value; onOverflow(ids);}
    };
    const observer = new ResizeObserver(check); observer.observe(element);
    element.querySelectorAll('[data-document-block]>*').forEach(child => observer.observe(child));
    const timer = requestAnimationFrame(check);
    element.addEventListener('load', check, true);
    return () => {cancelAnimationFrame(timer); observer.disconnect(); element.removeEventListener('load', check, true);};
  }, [layout, data, scale, onOverflow]);
  return <div ref={page} className={`document-layout-page ${standard ? 'document-layout-standard' : ''} ${className}`} style={{width: layout.page.width * scale, height: layout.page.height * scale, '--document-mm': `${scale}px`} as CSSProperties} aria-label="Prévia do documento em papel A4">
    {watermark && <ReportWatermark watermark={watermark}/>}
    <DocumentReportHeader brand={brand} scale={scale}/>
    {standard && <div className="document-layout-decoration" aria-hidden="true"><div className="document-metadata-panel" style={{left: 14 * scale, top: 47 * scale, width: 182 * scale, height: 16 * scale}}/><div className="document-values-panel" style={{left: 14 * scale, top: 161 * scale, width: 182 * scale, height: 20 * scale}}/><div className="document-signatures-rule" style={{left: 14 * scale, top: 203 * scale, width: 182 * scale}}/></div>}
    {layout.blocks.map(block => <div key={block.id} data-document-block={block.id} className={`document-layout-block document-layout-${block.type}`} style={documentBlockStyle(block, scale)}><BlockContent block={block} data={data} scale={scale}/></div>)}
    {children}
  </div>;
}
