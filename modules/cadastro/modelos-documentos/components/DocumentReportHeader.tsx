'use client';
import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {ReportHeader} from '@/shared/reporting/ReportHeader';
import {getReportHeaderMetrics, REPORT_MARGIN_MM} from '@/shared/reporting/reportLayout';
import {defaultReportHeaderVariant} from '@/modules/configuracoes/cabecalho-relatorios/types';
import type {RequestDocumentBrand} from '@/modules/solicitacoes/services/documentBrandApi';
import {DOCUMENT_BODY_TOP} from '../reportHeaderLayout';

export function DocumentReportHeader({brand, scale}: {brand?: RequestDocumentBrand; scale?: number}) {
  const container = useRef<HTMLDivElement>(null), [measuredScale, setMeasuredScale] = useState(3);
  useEffect(() => {
    if (scale !== undefined || !container.current) return;
    const element = container.current, observer = new ResizeObserver(() => setMeasuredScale(element.clientWidth / 210));
    observer.observe(element);return () => observer.disconnect();
  }, [scale]);
  const factor = scale ?? measuredScale, header = brand?.header ?? defaultReportHeaderVariant;
  const metrics = getReportHeaderMetrics(header.variant);
  const style = {
    width: '210mm', padding: `${REPORT_MARGIN_MM}mm`, transform: `scale(${factor / (96 / 25.4)})`, transformOrigin: 'top left',
    '--report-logo-width': `${metrics.logoWidthMm}mm`, '--report-logo-height': `${metrics.logoHeightMm}mm`, '--report-name-size': `${metrics.namePt}pt`,
    '--report-cnpj-size': `${metrics.cnpjPt}pt`, '--report-detail-size': `${metrics.detailPt}pt`, '--report-title-size': `${metrics.titlePt}pt`, '--report-brand-size': `${metrics.brandPt}pt`,
  } as CSSProperties;
  return <div ref={container} className="document-report-header" style={{height: DOCUMENT_BODY_TOP * factor, ...(scale !== undefined ? {width: 210 * scale} : {})}}><div className="report-portrait document-report-header-inner" style={style}><ReportHeader company={brand?.company ?? null} settings={header} title="Solicitação de serviço"/></div></div>;
}
