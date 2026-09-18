'use client';
/* eslint-disable @next/next/no-img-element -- Locally generated QR is an inline SVG data URL. */
import {useMemo} from 'react';
import {ShieldCheck} from 'lucide-react';
import {useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {qrSvgDataUrl} from '@/shared/reporting/qrCode';
import {checkDocumentHash, requestVerificationUrl} from '../reporting/requestVerification';
import type {ServiceRequest} from '../types';

export function RequestVerification({request}: {request: ServiceRequest}) {
  const {searchParams} = useModuleNavigation();
  const result = checkDocumentHash(searchParams.get('verificar'), request.documentHash);
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const url = requestVerificationUrl(request, origin);
  const qr = useMemo(() => qrSvgDataUrl(url), [url]);
  if (!request.documentHash) return null;
  return <section className="request-verification-card">
    <div className="request-section-heading"><ShieldCheck size={18}/><h3>Conferência do documento</h3></div>
    {result === 'valid' && <p className="request-verification-valid" role="status">O hash do QR Code confere com o registro salvo.</p>}
    {result === 'invalid' && <p className="request-inline-error" role="alert">O hash informado não corresponde a este documento. Confira o registro original antes de utilizar a cópia.</p>}
    <div className="request-verification-content"><a href={url} aria-label="Abrir conferência do documento"><img src={qr} width={116} height={116} alt="QR Code para conferir esta solicitação"/></a><div><p>O QR Code abre este registro para quem tem acesso ao sistema.</p><strong>Hash do documento</strong><code>{request.documentHash}</code><small>Modelo: {request.template?.name || 'Solicitação de serviço'} · versão {request.template?.version ?? 0}</small></div></div>
  </section>;
}
