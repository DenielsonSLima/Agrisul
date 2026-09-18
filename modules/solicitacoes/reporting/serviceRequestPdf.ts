import {loadReportImage} from '@/shared/reporting/loadReportImage';
import {fetchWatermark} from '@/modules/configuracoes/marca-dagua/services/watermarkApi';
import {documentWatermark} from '@/shared/reporting/documentWatermark';
import {drawReportPdfWatermark} from '@/shared/reporting/pdfWatermark';
import {defaultServiceRequestLayout} from '@/modules/cadastro/modelos-documentos/defaultLayout';
import {assertRequestActor, requestFileUrl, requestSignatureBucket} from '../services/requestApi';
import {requestDocumentData} from './requestDocumentData';
import {renderDocumentPdf} from './renderDocumentPdf';
import type {RequestExecution, ServiceRequest} from '../types';
import {fetchRequestDocumentBrand} from '../services/documentBrandApi';
import {drawReportPdfHeader} from '@/shared/reporting/pdfHeader';
import {REPORT_MARGIN_MM} from '@/shared/reporting/reportLayout';
import {DOCUMENT_BODY_TOP} from '@/modules/cadastro/modelos-documentos/reportHeaderLayout';
import {drawRequestPdfAudit, drawRequestPdfFooters} from './requestPdfAudit';

export async function buildServiceRequestPdf(request: ServiceRequest, execution: RequestExecution) {
  await assertRequestActor(execution);
  const {jsPDF} = await import('@/shared/reporting/jsPdfRuntime');
  const [requesterUrl, directorUrl, watermarkSettings, reportBrand] = await Promise.all([
    request.requester.signaturePath ? requestFileUrl(requestSignatureBucket, request.requester.signaturePath, execution.signal) : null,
    request.decision?.signaturePath ? requestFileUrl(requestSignatureBucket, request.decision.signaturePath, execution.signal) : null,
    fetchWatermark(execution.signal),
    fetchRequestDocumentBrand(execution.signal),
  ]);
  const watermark = documentWatermark(watermarkSettings);
  const [requester, director, watermarkImage, logo] = await Promise.all([loadReportImage(requesterUrl), loadReportImage(directorUrl), loadReportImage(watermark.imageUrl), loadReportImage(reportBrand.company?.logoUrl ?? null)]);
  const data = requestDocumentData(request, window.location.origin, {requester: requesterUrl, director: directorUrl});
  const doc = new jsPDF({orientation: 'portrait', unit: 'mm', format: 'a4', compress: true});
  doc.setProperties({title: `Solicitação de serviço nº ${request.number}`, subject: `Registro interno ${request.id} · ${request.documentHash || ''}`, author: request.createdBy.name});
  const drawBackground = () => {
    drawReportPdfWatermark(doc, 210, 297, watermark, watermarkImage);
    const headerBottom = drawReportPdfHeader({doc, pageWidth: 210, margin: REPORT_MARGIN_MM, orientation: 'portrait', settings: reportBrand.header, company: reportBrand.company, logo, title: 'Solicitação de serviço'});
    return Math.max(DOCUMENT_BODY_TOP, headerBottom + 4);
  };
  renderDocumentPdf(doc, request.template?.layout ?? defaultServiceRequestLayout, data, {requester, director}, drawBackground);

  // The printable manual form stays on its A4 template. Signed/decided records
  // carry a separate audit sheet even if someone removes verification blocks.
  if (request.requester.signaturePath || request.decision || request.complements?.length) drawRequestPdfAudit(doc, request, data, drawBackground);
  drawRequestPdfFooters(doc, request.number);
  await assertRequestActor(execution);
  return doc;
}

export async function createServiceRequestPdf(request: ServiceRequest, execution: RequestExecution) {
  const doc = await buildServiceRequestPdf(request, execution);
  doc.save(`solicitacao-servico-${request.number}.pdf`);
}
