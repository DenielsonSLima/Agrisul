'use client';

import {useMemo, useState} from 'react';
import {
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  FileDown,
  Loader2,
  PackageOpen,
  Plus,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';
import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import {useMaterials} from '../hooks/useQuotes';
import type {Quote, QuoteItem, QuoteProvider} from '../types';
import {QuoteAwardExportDialog} from './QuoteAwardExportDialog';

type QuoteSummaryTabProps = {
  quote: Quote;
  busy: boolean;
  finalizing: boolean;
  finalizeError: string;
  onFinalize: () => Promise<void>;
  onAddMaterials: () => void;
  onRemoveMaterial: (item: QuoteItem) => Promise<void>;
  removingItemId: string;
};

function resultLabel(quote: Quote, provider: QuoteProvider) {
  if ((provider.awardedItemCount ?? 0) > 0) {
    return quote.status === 'finished' ? 'Pedido gerado' : 'Itens aprovados';
  }
  if (quote.status === 'finished') return 'Não selecionado';
  if (!provider.isComplete) return 'Aguardando preços';
  if (quote.winningProviderIds.includes(provider.id)) {
    return quote.winningProviderIds.length > 1 ? 'Menor total (empate)' : 'Menor total';
  }
  return 'Proposta completa';
}

function resultTone(quote: Quote, provider: QuoteProvider) {
  if ((provider.awardedItemCount ?? 0) > 0) return 'winner';
  if (quote.status === 'finished') return 'lost';
  if (!provider.isComplete) return 'pending';
  if (quote.winningProviderIds.includes(provider.id)) return 'winner';
  return 'lost';
}

export function QuoteSummaryTab({
  quote,
  busy,
  finalizing,
  finalizeError,
  onFinalize,
  onAddMaterials,
  onRemoveMaterial,
  removingItemId,
}: QuoteSummaryTabProps) {
  const materialsQuery = useMaterials();
  const [exportProviderId, setExportProviderId] = useState<string | null>(null);
  const exportProvider = exportProviderId
    ? quote.providers.find(provider => provider.id === exportProviderId) ?? null
    : null;
  const materialImages = useMemo(
    () => new Map(materialsQuery.materials.map(material => [material.id, material.imageUrl] as const)),
    [materialsQuery.materials],
  );
  const completed = quote.providers.filter(provider => provider.isComplete).length;
  const itemAwards = quote.itemAwards ?? [];
  const awardedCount = quote.awardedItemCount ?? itemAwards.length;
  const readyToFinalize = quote.awardComplete ?? false;

  return (
    <section className="quote-summary-tab">
      <header className="quote-tab-heading">
        <div>
          <span className="quote-eyebrow">VISÃO GERAL</span>
          <h3>Resumo da cotação</h3>
          <p>Confira materiais, fornecedores, preços e a distribuição aprovada antes de gerar os pedidos.</p>
        </div>
        <span className={`billing-status ${quote.status === 'open' ? 'active' : 'completed'}`}>
          {quote.status === 'open' ? 'Em aberto' : 'Finalizada'}
        </span>
      </header>

      <div className="quote-summary-metrics">
        <article>
          <span><PackageOpen size={18}/></span>
          <div><strong>{quote.items.length}</strong><small>Materiais</small></div>
        </article>
        <article>
          <span><Users size={18}/></span>
          <div><strong>{quote.providers.length}</strong><small>Fornecedores</small></div>
        </article>
        <article>
          <span><Banknote size={18}/></span>
          <div><strong>{completed} de {quote.providers.length}</strong><small>Propostas completas</small></div>
        </article>
        <article>
          <span><Trophy size={18}/></span>
          <div><strong>{awardedCount} de {quote.items.length}</strong><small>Materiais aprovados</small></div>
        </article>
      </div>

      <article className="quote-summary-section">
        <header><ClipboardCheck size={18}/><div><h4>Dados da cotação</h4><p>Identificação e solicitante</p></div></header>
        <dl className="quote-summary-data">
          <div><dt>Número</dt><dd>{quote.number || 'Automático'}</dd></div>
          <div><dt>Data</dt><dd>{dateLabel(quote.requestDate)}</dd></div>
          <div><dt>Solicitante</dt><dd>{quote.requester}</dd></div>
          <div><dt>Situação</dt><dd>{quote.status === 'open' ? 'Em aberto' : 'Finalizada'}</dd></div>
        </dl>
        {quote.notes && <div className="quote-summary-notes"><strong>Observações</strong><p>{quote.notes}</p></div>}
      </article>

      <article className="quote-summary-section">
        <header>
          <PackageOpen size={18}/><div><h4>Materiais</h4><p>Itens solicitados nesta cotação</p></div>
          {quote.status === 'open' && (
            <button className="btn company-primary" type="button" disabled={busy} onClick={onAddMaterials}>
              <Plus size={15}/>Adicionar material
            </button>
          )}
        </header>
        <div className="quote-summary-table-wrap" role="region" aria-label="Materiais da cotação" tabIndex={0}>
          <table className="quote-summary-table">
            <thead><tr><th scope="col">Material</th><th scope="col">Referências</th><th scope="col">Quantidade</th><th scope="col">Aprovação</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {quote.items.map(item => {
                const references = item.materialReferences
                  .map(reference => [reference.brand, reference.code].filter(Boolean).join(' '))
                  .join(' · ');
                const award = itemAwards.find(entry => entry.itemId === item.id);
                const provider = award ? quote.providers.find(entry => entry.id === award.providerId) : null;
                const hasPriceOrHistory = quote.negotiations.some(entry => entry.itemId === item.id)
                  || quote.providers.some(entry => !!entry.values[item.id])
                  || !!award;
                const cannotRemove = quote.items.length <= 1 || hasPriceOrHistory;
                const removeTitle = quote.items.length <= 1
                  ? 'A cotação precisa manter ao menos um material.'
                  : hasPriceOrHistory
                    ? 'Materiais com preço, histórico ou aprovação não podem ser removidos.'
                    : `Remover ${item.materialName}`;
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.materialName}</strong>
                      {item.materialCode && <small>Código interno: {item.materialCode}</small>}
                      {item.notes && <small>{item.notes}</small>}
                    </td>
                    <td>{references || 'Sem referência'}</td>
                    <td><strong>{item.quantity} {item.unit}</strong></td>
                    <td>
                      {provider && award ? (
                        <span className="quote-summary-award"><strong>{provider.providerName}</strong><small>{moneyLabel(award.lineTotal)}</small></span>
                      ) : <span className="quote-result-badge pending">Pendente</span>}
                    </td>
                    <td className="quote-summary-row-actions">
                      {quote.status === 'open' && (
                        <button
                          className="icon-btn danger"
                          type="button"
                          disabled={busy || cannotRemove}
                          title={removeTitle}
                          aria-label={`Remover ${item.materialName} da cotação`}
                          onClick={() => void onRemoveMaterial(item)}
                        >
                          {removingItemId === item.id
                            ? <Loader2 className="animate-spin" size={15}/>
                            : <Trash2 size={15}/>}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className="quote-summary-section">
        <header><Trophy size={18}/><div><h4>Fornecedores e resumo de preços</h4><p>Valores e aprovações calculados pelo banco</p></div></header>
        {materialsQuery.error && (
          <p className="quote-summary-export-warning" role="status">As fotos não foram carregadas. O PDF aprovado ainda pode ser exportado sem elas.</p>
        )}
        <div className="quote-summary-table-wrap" role="region" aria-label="Resumo de preços por fornecedor" tabIndex={0}>
          <table className="quote-summary-table quote-result-table">
            <thead>
              <tr>
                <th scope="col">Fornecedor</th><th scope="col">Preenchimento</th><th scope="col">Total cotado</th>
                <th scope="col">Itens aprovados</th><th scope="col">Total aprovado</th><th scope="col">Resultado</th>
                <th scope="col"><span className="sr-only">Exportação</span></th>
              </tr>
            </thead>
            <tbody>
              {quote.providers.map(provider => {
                const providerAwardCount = provider.awardedItemCount ?? 0;
                return (
                  <tr key={provider.id} className={resultTone(quote, provider)}>
                    <td><strong>{provider.providerName}</strong></td>
                    <td>{provider.quotedItemCount ?? 0} de {quote.items.length} itens</td>
                    <td><strong>{provider.quotedItemCount ? moneyLabel(provider.total) : '—'}</strong></td>
                    <td><strong>{providerAwardCount}</strong> de {quote.items.length}</td>
                    <td><strong>{providerAwardCount ? moneyLabel(provider.awardedTotal) : '—'}</strong></td>
                    <td><span className={`quote-result-badge ${resultTone(quote, provider)}`}>{resultLabel(quote, provider)}</span></td>
                    <td className="quote-summary-export-cell">
                      <button
                        className="btn"
                        type="button"
                        disabled={!providerAwardCount || materialsQuery.loading}
                        title={!providerAwardCount ? 'Aprove ao menos um material para este fornecedor' : undefined}
                        aria-label={`Exportar itens aprovados para ${provider.providerName}`}
                        onClick={() => setExportProviderId(provider.id)}
                      >
                        {materialsQuery.loading ? <Loader2 className="animate-spin" size={15} aria-hidden="true"/> : <FileDown size={15} aria-hidden="true"/>}
                        Exportar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      {quote.status === 'open' && (
        <div className="quote-finalize-panel quote-summary-finalize">
          <div>
            <strong>{readyToFinalize ? 'Pedidos prontos para gerar' : 'Conclua a aprovação dos materiais'}</strong>
            <p>{readyToFinalize
              ? 'Todos os itens possuem fornecedor e preço aprovados. Ao finalizar, será criado um pedido para cada fornecedor selecionado.'
              : `Ainda faltam ${Math.max(quote.items.length - awardedCount, 0)} material(is) para aprovar na aba Negociação.`}</p>
            {finalizeError && <p className="form-error" role="alert">{finalizeError}</p>}
          </div>
          <button className="btn company-primary" type="button" disabled={busy || !readyToFinalize} onClick={() => void onFinalize()}>
            {finalizing ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>}
            {finalizing ? 'Finalizando…' : 'Finalizar cotação'}
          </button>
        </div>
      )}

      {exportProvider && (
        <QuoteAwardExportDialog
          quote={quote}
          provider={exportProvider}
          materialImages={materialImages}
          onClose={() => setExportProviderId(null)}
        />
      )}
    </section>
  );
}
