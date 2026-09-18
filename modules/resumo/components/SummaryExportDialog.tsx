import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import {createSummaryPdf} from '../reporting/summaryPdf';
import type {ExecutiveSummarySnapshot} from '../types';

export function SummaryExportDialog({snapshot,onClose}:{snapshot:ExecutiveSummarySnapshot;onClose:()=>void}){
 return <PdfExportDialog snapshot={snapshot} companyId={snapshot.companyId} createPdf={createSummaryPdf}
  title="Resumo gerencial completo" description="Confira contratos, faturamento, carregamentos, fazendas, planejamento e manejo em um único arquivo."
  previewClassName="summary-pdf-preview" onClose={onClose}/>;
}
