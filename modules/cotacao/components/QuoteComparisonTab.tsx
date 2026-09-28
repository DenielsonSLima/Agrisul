'use client';

import {ArrowRight, CheckCircle2, Loader2, PackageOpen, Store, Trophy} from 'lucide-react';
import {moneyLabel} from '@/shared/utils/presentation';
import type {Quote, QuoteItem, QuoteItemAward, QuoteProvider} from '../types';

type QuoteComparisonTabProps = {
  quote: Quote;
  busy: boolean;
  finalizing: boolean;
  finalizeError: string;
  onFinalize: () => Promise<void>;
  onGoToNegotiation: () => void;
};

type ProviderAllocation = {
  provider: QuoteProvider;
  rows: Array<{award: QuoteItemAward; item: QuoteItem}>;
};

function approvedAllocations(quote: Quote): ProviderAllocation[] {
  const itemById = new Map(quote.items.map(item => [item.id, item]));

  return quote.providers
    .map(provider => ({
      provider,
      rows: (quote.itemAwards ?? []).flatMap(award => {
        if (award.providerId !== provider.id) return [];
        const item = itemById.get(award.itemId);
        return item ? [{award, item}] : [];
      }),
    }))
    .filter(allocation => allocation.rows.length > 0);
}

function discountText(award: QuoteItemAward) {
  if (award.discountType === 'percentage') {
    return `${award.discountValue.replace('.', ',')}% · ${moneyLabel(award.discountAmount)}`;
  }
  if (award.discountType === 'amount') return moneyLabel(award.discountAmount);
  return 'Sem desconto';
}

export function QuoteComparisonTab({
  quote,
  busy,
  finalizing,
  finalizeError,
  onFinalize,
  onGoToNegotiation,
}: QuoteComparisonTabProps) {
  const allocations = approvedAllocations(quote);
  const isComplete = quote.awardComplete;

  return (
    <section className="quote-comparison-tab">
      <header className="quote-tab-heading">
        <div>
          <span className="quote-eyebrow">COMPARATIVO FINAL</span>
          <h3>Compras separadas por loja</h3>
          <p>Confira os itens escolhidos, quanto será comprado em cada fornecedor e o total geral antes de finalizar.</p>
        </div>
        <span className={`billing-status ${isComplete ? 'completed' : 'active'}`}>
          {isComplete ? 'Seleção completa' : `${quote.pendingAwardCount} pendente(s)`}
        </span>
      </header>

      <div className="quote-comparison-overview" aria-label="Resumo da seleção">
        <article>
          <span><Store size={19}/></span>
          <div><small>Lojas escolhidas</small><strong>{allocations.length}</strong></div>
        </article>
        <article>
          <span><PackageOpen size={19}/></span>
          <div><small>Itens escolhidos</small><strong>{quote.awardedItemCount} de {quote.items.length}</strong></div>
        </article>
        <article>
          <span><Trophy size={19}/></span>
          <div><small>Total bruto escolhido</small><strong>{moneyLabel(quote.awardedGrossTotal)}</strong></div>
        </article>
        <article className="is-total">
          <span><CheckCircle2 size={19}/></span>
          <div><small>Total final da compra</small><strong>{moneyLabel(quote.awardedTotal)}</strong></div>
        </article>
      </div>

      {allocations.length ? (
        <div className="quote-comparison-grid">
          {allocations.map(({provider, rows}, index) => (
            <article className="quote-comparison-store" key={provider.id}>
              <header>
                <span className="quote-comparison-store-index">Loja {String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h4>{provider.providerName}</h4>
                  <p>{rows.length} {rows.length === 1 ? 'item escolhido' : 'itens escolhidos'}</p>
                </div>
              </header>

              <div
                className="quote-final-comparison-table-wrap"
                role="region"
                aria-label={`Itens escolhidos em ${provider.providerName}`}
                tabIndex={0}
              >
                <table className="quote-final-comparison-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Quantidade</th>
                      <th scope="col">Unitário bruto</th>
                      <th scope="col">Desconto</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({award, item}) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.materialName}</strong>
                          {item.materialCode && <small>Cód. {item.materialCode}</small>}
                        </td>
                        <td><strong>{item.quantity} {item.unit}</strong></td>
                        <td>{moneyLabel(award.unitPrice)}</td>
                        <td>{discountText(award)}</td>
                        <td><strong>{moneyLabel(award.lineTotal)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <footer>
                <span><small>Bruto escolhido</small><strong>{moneyLabel(provider.awardedGrossTotal)}</strong></span>
                <span className="is-net"><small>Total nesta loja</small><strong>{moneyLabel(provider.awardedTotal)}</strong></span>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="quote-comparison-empty">
          <Store size={28}/>
          <strong>Nenhum item escolhido ainda</strong>
          <p>Aprove uma loja para cada item na aba Negociação para montar o comparativo final.</p>
          {quote.status === 'open' && (
            <button className="btn company-primary" type="button" onClick={onGoToNegotiation}>
              Ir para negociação<ArrowRight size={15}/>
            </button>
          )}
        </div>
      )}

      {quote.status === 'open' && allocations.length > 0 && (
        <div className={`quote-comparison-finalize ${isComplete ? 'is-ready' : ''}`}>
          <div>
            <strong>{isComplete ? 'Comparativo pronto para finalizar' : 'Ainda existem itens sem loja escolhida'}</strong>
            <p>{isComplete
              ? `${quote.awardedItemCount} item(ns) serão distribuídos entre ${allocations.length} loja(s), totalizando ${moneyLabel(quote.awardedTotal)}.`
              : `Escolha o fornecedor de mais ${quote.pendingAwardCount} item(ns) para concluir esta cotação.`}</p>
            {finalizeError && <p className="form-error" role="alert">{finalizeError}</p>}
          </div>
          {isComplete ? (
            <button className="btn company-primary" type="button" disabled={busy} onClick={() => void onFinalize()}>
              {finalizing ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>}
              {finalizing ? 'Finalizando…' : 'Finalizar e gerar pedidos'}
            </button>
          ) : (
            <button className="btn" type="button" disabled={busy} onClick={onGoToNegotiation}>
              Completar seleção<ArrowRight size={15}/>
            </button>
          )}
        </div>
      )}

      {quote.status === 'finished' && allocations.length > 0 && (
        <div className="quote-comparison-complete">
          <CheckCircle2 size={18}/>
          <div><strong>Cotação finalizada</strong><p>Os pedidos foram separados conforme esta distribuição por loja.</p></div>
        </div>
      )}
    </section>
  );
}
