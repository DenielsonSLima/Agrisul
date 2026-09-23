'use client';

import {useMemo} from 'react';
import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {
  createQuotationAwardPdf,
  createQuotationAwardSnapshot,
} from '../reporting/quotationAwardPdf';
import type {Quote, QuoteProvider} from '../types';

export function QuoteAwardExportDialog({
  quote,
  provider,
  materialImages,
  onClose,
}: {
  quote: Quote;
  provider: QuoteProvider;
  materialImages: ReadonlyMap<string, string | null>;
  onClose: () => void;
}) {
  const {activeCompanyId} = useWorkspaceCompany();
  const snapshot = useMemo(
    () => createQuotationAwardSnapshot(quote, provider, materialImages),
    [quote, provider, materialImages],
  );

  return (
    <PdfExportDialog
      snapshot={snapshot}
      companyId={activeCompanyId}
      createPdf={createQuotationAwardPdf}
      orientation="portrait"
      fitPreviewToWidth
      showPreviewToolbar
      title="Exportar itens aprovados"
      description={`${provider.providerName} · ${snapshot.items.length} item(ns) · confira valores e quantidades antes de baixar.`}
      onClose={onClose}
    />
  );
}
