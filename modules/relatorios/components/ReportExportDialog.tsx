import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import {createReportPdf} from '../reporting/reportPdf';
import type {ReportSnapshot} from '../types';

export function ReportExportDialog({snapshot, onClose}: {snapshot: ReportSnapshot; onClose: () => void}) {
  return <PdfExportDialog snapshot={snapshot} companyId={snapshot.companyId} createPdf={createReportPdf} title="Prévia do relatório" description="Confira o documento completo antes de baixar ou imprimir o PDF." previewClassName="reports-pdf-preview" onClose={onClose}/>;
}
