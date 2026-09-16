import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import {monthLabel} from '@/shared/utils/presentation';
import {createAgendaPdf} from '../reporting/agendaPdf';
import {agendaFilterLabel} from '../utils/agendaPresentation';
import type {AgendaSnapshot} from '../types';
export function AgendaExportDialog({snapshot,onClose}:{snapshot:AgendaSnapshot;onClose:()=>void}) {
  return <PdfExportDialog snapshot={snapshot} companyId={snapshot.companyId} createPdf={createAgendaPdf} orientation="portrait" title="Exportar agenda" description={`${monthLabel(snapshot.data.month)} · ${agendaFilterLabel(snapshot.kind)}. Calendário na metade superior e detalhes abaixo, com continuação em outras páginas quando necessário.`} previewClassName="agenda-pdf-preview" onClose={onClose}/>;
}
