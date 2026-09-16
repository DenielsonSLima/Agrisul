import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import {dateLabel} from '@/shared/utils/presentation';
import {createPlanningDiaryPdf} from '../reporting/planningDiaryPdf';
import {createPlanningPdf} from '../reporting/planningPdf';
import type {PlanningExportSnapshot} from '../types';

export function PlanningExportDialog({snapshot,onClose}:{snapshot:PlanningExportSnapshot;onClose:()=>void}){
 const diary=snapshot.kind==='diary';
 const reportFrom=diary?snapshot.data.diaryPeriodSummary.dateFrom:snapshot.period.startDate;
 const reportTo=diary?snapshot.data.diaryPeriodSummary.dateTo:snapshot.period.endDate;
 return <PdfExportDialog snapshot={snapshot} companyId={snapshot.companyId} createPdf={diary?createPlanningDiaryPdf:createPlanningPdf} orientation="landscape" title={diary?'Exportar Diário de campo':'Exportar planejamento'} description={`${snapshot.period.name} · ${dateLabel(reportFrom)} a ${dateLabel(reportTo)}. ${diary?'O relatório contém somente os movimentos do Diário de campo dentro do período filtrado.':'Confira a prévia completa antes de baixar ou imprimir.'}`} previewClassName="planning-pdf-preview" onClose={onClose}/>;
}
