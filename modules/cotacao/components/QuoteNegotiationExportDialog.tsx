'use client';

import {useState} from 'react';
import {FileDown} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import {moneyLabel} from '@/shared/utils/presentation';
import {
  createQuotationNegotiationPdf,
  type QuotationNegotiationSnapshot,
  type QuotationProviderTerms,
} from '../reporting/quotationNegotiationPdf';

const emptyTerms = (): QuotationProviderTerms => ({paymentTerms: '', deliveryTime: '', proposalValidity: ''});

export function QuoteNegotiationExportDialog({snapshot, companyId, onClose}: {
  snapshot: QuotationNegotiationSnapshot;
  companyId: string;
  onClose: () => void;
}) {
  const [providerTerms, setProviderTerms] = useState(() => snapshot.providerTerms ?? {});
  const [closingNotes, setClosingNotes] = useState(snapshot.closingNotes ?? '');
  const [preview, setPreview] = useState<QuotationNegotiationSnapshot | null>(null);

  const updateTerms = (providerId: string, field: keyof QuotationProviderTerms, value: string) => {
    setProviderTerms(current => ({
      ...current,
      [providerId]: {...(current[providerId] ?? emptyTerms()), [field]: value},
    }));
  };

  if (preview) {
    return (
      <PdfExportDialog
        snapshot={preview}
        companyId={companyId}
        createPdf={createQuotationNegotiationPdf}
        orientation="landscape"
        fitPreviewToWidth
        showPreviewToolbar
        title="Exportar mapa de negociação"
        description={`${snapshot.number || snapshot.title} · Mapa completo e resumo final com as condições preenchidas. Feche a prévia para ajustar os campos.`}
        previewClassName="quote-negotiation-pdf-preview"
        onClose={() => setPreview(null)}
      />
    );
  }

  return (
    <Dialog open onOpenChange={open => {if (!open) onClose();}}>
      <DialogContent className="form-modal quote-negotiation-export-dialog">
        <DialogHeader>
          <DialogTitle>Resumo final da cotação</DialogTitle>
          <DialogDescription>
            Preencha as condições para a última página do PDF. Campos em branco terão espaço para preenchimento manual.
          </DialogDescription>
        </DialogHeader>
        <form className="quote-negotiation-export-form" onSubmit={event => {
          event.preventDefault();
          setPreview({
            ...snapshot,
            providerTerms: Object.fromEntries(Object.entries(providerTerms).map(([id, terms]) => [id, {
              paymentTerms: terms.paymentTerms.trim(),
              deliveryTime: terms.deliveryTime.trim(),
              proposalValidity: terms.proposalValidity.trim(),
            }])),
            closingNotes: closingNotes.trim(),
          });
        }}>
          <div className="quote-export-overview" aria-label="Resumo das aprovações">
            <span><strong>{snapshot.items.length}</strong> materiais na cotação</span>
            <span><strong>{snapshot.awardedItemCount}</strong> materiais aprovados</span>
            <span><strong>{moneyLabel(snapshot.awardedTotal)}</strong> aprovados</span>
          </div>
          <div className="quote-export-provider-list">
            {snapshot.providers.map(provider => {
              const terms = providerTerms[provider.id] ?? emptyTerms();
              return (
                <fieldset className="quote-export-provider" key={provider.id}>
                  <legend>{provider.providerName}</legend>
                  <p>{provider.awardedItemCount ?? 0} material(is) aprovado(s) · <strong>{moneyLabel(provider.awardedTotal ?? '0')}</strong></p>
                  <div className="quote-export-terms-grid">
                    <Field label="Condição de pagamento">
                      <input maxLength={120} placeholder="Ex.: 30/60/90 dias" value={terms.paymentTerms}
                        onChange={event => updateTerms(provider.id, 'paymentTerms', event.target.value)}/>
                    </Field>
                    <Field label="Prazo de entrega">
                      <input maxLength={120} placeholder="Ex.: 5 dias úteis após o pedido" value={terms.deliveryTime}
                        onChange={event => updateTerms(provider.id, 'deliveryTime', event.target.value)}/>
                    </Field>
                    <Field label="Validade da proposta">
                      <input maxLength={80} placeholder="Ex.: até 30/11/2026 ou 10 dias" value={terms.proposalValidity}
                        onChange={event => updateTerms(provider.id, 'proposalValidity', event.target.value)}/>
                    </Field>
                  </div>
                </fieldset>
              );
            })}
          </div>
          <Field label="Observações finais">
            <textarea maxLength={1000} rows={3} placeholder="Condições adicionais, local de entrega ou observações para o fechamento"
              value={closingNotes} onChange={event => setClosingNotes(event.target.value)}/>
          </Field>
          <div className="form-actions">
            <button className="btn" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn company-primary" type="submit"><FileDown size={16}/>Gerar prévia do PDF</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
