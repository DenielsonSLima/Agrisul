'use client';

import {useMemo, useState} from 'react';
import {FileDown, Loader2, Plus, RefreshCw, Trash2, Users} from 'lucide-react';
import {providerDocument} from '@/modules/cadastro/prestadores/presentation';
import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import {formatReportPhone} from '@/shared/reporting';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {moneyLabel} from '@/shared/utils/presentation';
import {
  createQuotationRequestPdf,
  type QuotationRequestSnapshot,
} from '../reporting/quotationRequestPdf';
import {useMaterials} from '../hooks/useQuotes';
import type {Quote, QuoteProvider} from '../types';

function quotationRequestSnapshot(
  quote: Quote,
  provider: QuoteProvider,
  materialImages: ReadonlyMap<string, string | null>,
): QuotationRequestSnapshot {
  return {
    title: quote.title,
    number: quote.number,
    requestDate: quote.requestDate,
    notes: quote.notes,
    items: quote.items.map(item => ({
      ...item,
      materialImageUrl: materialImages.get(item.materialId) ?? null,
    })),
    provider,
  };
}

function documentLabel(provider: QuoteProvider) {
  const document = provider.providerDocument?.trim();
  if (!document) return 'Documento não informado';
  const digits = document.replace(/\D/g, '');
  const documentType = provider.providerDocumentType === 'CPF'
    || provider.providerDocumentType === 'CNPJ'
    ? provider.providerDocumentType
    : digits.length === 11 ? 'CPF' : 'CNPJ';
  return `${documentType}: ${providerDocument({documentType, document})}`;
}

function statusLabel(provider: QuoteProvider, itemCount: number) {
  if (provider.isComplete) return 'Proposta completa';
  return `${provider.quotedItemCount ?? 0} de ${itemCount} preços informados`;
}

function resultLabel(quote: Quote, provider: QuoteProvider) {
  const awarded = provider.awardedItemCount ?? 0;
  if (awarded > 0) {
    if (quote.status === 'finished') return 'Pedido gerado';
    return `${awarded} ${awarded === 1 ? 'item aprovado' : 'itens aprovados'}`;
  }
  if (quote.winnerProviderId === provider.id) return 'Vencedor';
  if (quote.status === 'finished') return 'Não selecionado';
  if (!provider.isComplete) return 'Aguardando';
  if (quote.winningProviderIds.includes(provider.id)) {
    return quote.winningProviderIds.length > 1 ? 'Menor total (empate)' : 'Menor total';
  }
  return 'Proposta completa';
}

function resultTone(quote: Quote, provider: QuoteProvider) {
  if ((provider.awardedItemCount ?? 0) > 0) return 'winner';
  if (quote.winnerProviderId === provider.id) return 'winner';
  if (quote.status === 'finished') return 'lost';
  if (!provider.isComplete) return 'pending';
  if (quote.winningProviderIds.includes(provider.id)) return 'winner';
  return 'lost';
}

export function QuoteProvidersTab({
  quote,
  onAddProviders,
  onRemoveProvider,
  addingProviders = false,
  removingProviderId = '',
}: {
  quote: Quote;
  onAddProviders?: () => void;
  onRemoveProvider?: (provider: QuoteProvider) => Promise<void>;
  addingProviders?: boolean;
  removingProviderId?: string;
}) {
  const {activeCompanyId} = useWorkspaceCompany();
  const materialsQuery = useMaterials();
  const [pdf, setPdf] = useState<QuotationRequestSnapshot | null>(null);
  const materialImages = useMemo(
    () => new Map(materialsQuery.materials.map(material => [material.id, material.imageUrl] as const)),
    [materialsQuery.materials],
  );

  return (
    <section className="quote-provider-directory" aria-labelledby="quote-providers-title">
      <header className="quote-tab-heading">
        <div>
          <span className="quote-eyebrow">DESTINATÁRIOS</span>
          <h3 id="quote-providers-title">Fornecedores da cotação</h3>
          <p>Consulte os dados, acompanhe as propostas e exporte a solicitação individual de cada fornecedor.</p>
        </div>
        <div className="quote-provider-heading-actions">
          <span>{quote.providers.length} fornecedor(es)</span>
          {quote.status === 'open' && onAddProviders && (
            <button
              className="btn company-primary"
              type="button"
              disabled={addingProviders}
              onClick={onAddProviders}
            >
              {addingProviders
                ? <Loader2 className="animate-spin" size={15} aria-hidden="true"/>
                : <Plus size={15} aria-hidden="true"/>}
              Adicionar fornecedor
            </button>
          )}
        </div>
      </header>

      {materialsQuery.error && (
        <div className="quote-pdf-assets-error" role="alert">
          <span>As fotos dos materiais não puderam ser carregadas. O PDF pode ser gerado sem elas.</span>
          <button className="btn" type="button" onClick={() => void materialsQuery.reload()}>
            <RefreshCw size={14} aria-hidden="true"/>Tentar novamente
          </button>
        </div>
      )}

      {quote.providers.length ? (
        <div
          className="quote-provider-directory-table-wrap"
          role="region"
          aria-label="Fornecedores vinculados à cotação"
          tabIndex={0}
        >
          <table className="quote-provider-directory-table">
            <caption className="sr-only">Dados e resultado dos fornecedores desta cotação</caption>
            <thead>
              <tr>
                <th scope="col">Fornecedor</th>
                <th scope="col">Contato</th>
                <th scope="col">Status</th>
                <th scope="col">Total</th>
                <th scope="col">Resultado</th>
                <th scope="col"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {quote.providers.map(provider => {
                const hasPriceOrHistory = (provider.quotedItemCount ?? 0) > 0
                  || quote.negotiations.some(entry => entry.providerId === provider.id)
                  || (provider.awardedItemCount ?? 0) > 0;
                return <tr key={provider.id}>
                  <td>
                    <strong>{provider.providerName}</strong>
                    <small>{provider.providerTradeName || 'Nome fantasia não informado'}</small>
                    <small>{documentLabel(provider)}</small>
                  </td>
                  <td className="quote-provider-contact">
                    {provider.providerEmail ? (
                      <a href={`mailto:${provider.providerEmail}`}>{provider.providerEmail}</a>
                    ) : <span>E-mail não informado</span>}
                    {provider.providerPhone ? (
                      <a href={`tel:${provider.providerPhone.replace(/\D/g, '')}`}>
                        {formatReportPhone(provider.providerPhone)}
                      </a>
                    ) : <small>Telefone não informado</small>}
                  </td>
                  <td>
                    <strong>{provider.isComplete ? 'Completa' : 'Pendente'}</strong>
                    <small>{statusLabel(provider, quote.items.length)}</small>
                  </td>
                  <td className="quote-provider-total">
                    <strong>{provider.quotedItemCount ? moneyLabel(provider.total) : '—'}</strong>
                  </td>
                  <td className="quote-provider-result">
                    <span className={`quote-result-badge ${resultTone(quote, provider)}`}>
                      {resultLabel(quote, provider)}
                    </span>
                  </td>
                  <td className="quote-provider-export">
                    <div className="quote-provider-row-actions">
                      <button
                        className="btn"
                        type="button"
                        disabled={materialsQuery.loading}
                        aria-label={`Exportar solicitação para ${provider.providerName}`}
                        onClick={() => setPdf(quotationRequestSnapshot(quote, provider, materialImages))}
                      >
                        {materialsQuery.loading
                          ? <Loader2 className="animate-spin" size={15} aria-hidden="true"/>
                          : <FileDown size={15} aria-hidden="true"/>}
                        {materialsQuery.loading ? 'Preparando fotos…' : 'Exportar'}
                      </button>
                      {quote.status === 'open' && onRemoveProvider && (
                        <button
                          className="icon-btn danger"
                          type="button"
                          disabled={addingProviders || hasPriceOrHistory}
                          title={hasPriceOrHistory
                            ? 'Fornecedores com preço, histórico ou aprovação não podem ser removidos.'
                            : `Remover ${provider.providerName}`}
                          aria-label={`Remover ${provider.providerName} da cotação`}
                          onClick={() => void onRemoveProvider(provider)}
                        >
                          {removingProviderId === provider.id
                            ? <Loader2 className="animate-spin" size={15}/>
                            : <Trash2 size={15}/>}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="company-empty">
          <Users size={24} aria-hidden="true"/>
          <h3>Nenhum fornecedor selecionado</h3>
          <p>Esta cotação ainda não possui destinatários para exportação.</p>
        </div>
      )}

      {pdf&&(
        <PdfExportDialog
          snapshot={pdf}
          companyId={activeCompanyId}
          createPdf={createQuotationRequestPdf}
          orientation="portrait"
          title="Exportar solicitação de cotação"
          description={`${pdf.provider.providerName} · ${quote.number || quote.title}. Confira a prévia antes de baixar ou imprimir.`}
          onClose={()=>setPdf(null)}
        />
      )}
    </section>
  );
}
