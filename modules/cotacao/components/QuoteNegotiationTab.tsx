'use client';

import {useMemo, useState} from 'react';
import {Check, FileDown, History, Loader2, PackageOpen, Plus, ReceiptText, X} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {moneyLabel} from '@/shared/utils/presentation';
import {useConfirmation} from '@/shared/feedback';
import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {
  createQuotationNegotiationPdf,
  createQuotationNegotiationSnapshot,
  type QuotationNegotiationSnapshot,
} from '../reporting/quotationNegotiationPdf';
import type {
  Material,
  Quote,
  QuoteItem,
  QuoteItemAwardInput,
  QuoteItemUnawardInput,
  QuoteNegotiation,
  QuoteNegotiationInput,
  QuoteOffer,
  QuoteProvider,
} from '../types';
import {MaterialThumbnail} from './QuoteMaterialPicker';
import {QuotePriceDialog} from './QuotePriceDialog';

type NegotiationDraft = Omit<QuoteNegotiationInput, 'id'>;
type AwardDraft = Omit<QuoteItemAwardInput, 'id'>;
type UnawardDraft = Omit<QuoteItemUnawardInput, 'id'>;

type QuoteNegotiationTabProps = {
  quote: Quote;
  materials: Material[];
  saving: boolean;
  onRecord: (input: NegotiationDraft) => Promise<void>;
  onApproveItem: (input: AwardDraft) => Promise<void>;
  onUnapproveItem: (input: UnawardDraft) => Promise<void>;
  onAddMaterials: () => void;
};

type PriceEditor = {
  item: QuoteItem;
  provider: QuoteProvider;
  history: QuoteNegotiation[];
  currentPrice: string;
  currentOffer?: QuoteOffer;
};

function newestFirst(left: QuoteNegotiation, right: QuoteNegotiation) {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return right.version - left.version;
}

function negotiationHistory(quote: Quote, itemId: string, providerId: string) {
  return quote.negotiations
    .filter(entry => entry.itemId === itemId && entry.providerId === providerId)
    .sort(newestFirst);
}

function referenceLabel(item: QuoteItem) {
  return item.materialReferences
    .map(reference => [reference.brand, reference.code].filter(Boolean).join(' '))
    .join(' · ');
}

export function providerAbbreviation(name: string) {
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .match(/[A-Z0-9]+/g) ?? [];
  const legalSuffixes = new Set(['LTDA', 'EIRELI', 'ME', 'EPP', 'SA']);
  const relevant = words.filter(word => !legalSuffixes.has(word) && !['DA', 'DE', 'DO', 'DAS', 'DOS', 'EM'].includes(word));
  const source = relevant.length ? relevant : words;
  if (!source.length) return 'FOR';
  if (source.length === 1) return source[0].slice(0, 4);
  return source.slice(0, 4).map(word => word[0]).join('');
}

function timestampLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não informada';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function discountLabel(type: QuoteOffer['discountType'], value: string) {
  if (type === 'percentage') return `desc. ${value.replace('.', ',')}%`;
  if (type === 'amount') return `desc. ${moneyLabel(value)}`;
  return '';
}

function ProviderHeading({provider}: {provider: QuoteProvider}) {
  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          <abbr
            className="quote-matrix-provider-abbreviation"
            title={provider.providerName}
            tabIndex={0}
            aria-label={`Fornecedor: ${provider.providerName}`}
          >
            {providerAbbreviation(provider.providerName)}
          </abbr>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={7}>{provider.providerName}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function QuoteNegotiationTab({
  quote,
  materials,
  saving,
  onRecord,
  onApproveItem,
  onUnapproveItem,
  onAddMaterials,
}: QuoteNegotiationTabProps) {
  const {activeCompanyId} = useWorkspaceCompany();
  const confirm = useConfirmation();
  const [priceEditor, setPriceEditor] = useState<PriceEditor | null>(null);
  const [pdf, setPdf] = useState<QuotationNegotiationSnapshot | null>(null);
  const [approvingKey, setApprovingKey] = useState('');
  const [approvalError, setApprovalError] = useState('');
  const history = useMemo(() => [...quote.negotiations].sort(newestFirst), [quote.negotiations]);
  const materialById = useMemo(
    () => new Map(materials.map(material => [material.id, material])),
    [materials],
  );
  const itemById = useMemo(() => new Map(quote.items.map(item => [item.id, item])), [quote.items]);
  const providerById = useMemo(
    () => new Map(quote.providers.map(provider => [provider.id, provider])),
    [quote.providers],
  );
  const approvedProviderByItem = useMemo(
    () => Object.fromEntries((quote.itemAwards ?? []).map(award => [award.itemId, award.providerId])),
    [quote.itemAwards],
  );

  const approveItem = async (item: QuoteItem, provider: QuoteProvider) => {
    if (saving || approvingKey || quote.status !== 'open') return;
    const key = `${item.id}:${provider.id}`;
    setApprovalError('');
    setApprovingKey(key);
    try {
      await onApproveItem({quotationItemId: item.id, quotationProviderId: provider.id});
    } catch (reason) {
      setApprovalError((reason as Error).message || 'Não foi possível aprovar o fornecedor para este item.');
    } finally {
      setApprovingKey('');
    }
  };

  const unapproveItem = async (item: QuoteItem, provider: QuoteProvider) => {
    if (saving || approvingKey || quote.status !== 'open') return;
    const accepted = await confirm({
      title: 'Remover aprovação?',
      description: `${provider.providerName} deixará de ser o fornecedor aprovado para ${item.materialName}. O material ficará sem fornecedor selecionado até uma nova aprovação.`,
      confirmLabel: 'Remover aprovação',
      tone: 'destructive',
    });
    if (!accepted) return;
    const key = `${item.id}:${provider.id}`;
    setApprovalError('');
    setApprovingKey(key);
    try {
      await onUnapproveItem({quotationItemId: item.id});
    } catch (reason) {
      setApprovalError((reason as Error).message || 'Não foi possível remover a aprovação do material.');
    } finally {
      setApprovingKey('');
    }
  };

  return (
    <section className="quote-negotiation-tab">
      <header className="quote-tab-heading quote-negotiation-heading">
        <div>
          <span className="quote-eyebrow">NEGOCIAÇÃO</span>
          <h3>Mapa de preços e aprovações</h3>
          <p>Compare todos os fornecedores na mesma tabela, registre novas versões e aprove a melhor opção de cada material.</p>
        </div>
        <div className="quote-negotiation-heading-actions">
          <span className="quote-negotiation-count">
            <History size={15}/>{quote.negotiations.length} registros
          </span>
          <button
            className="btn"
            type="button"
            disabled={!quote.items.length || !quote.providers.length}
            onClick={() => setPdf(createQuotationNegotiationSnapshot(
              quote,
              new Map(quote.items.map(item => [
                item.materialId,
                materialById.get(item.materialId)?.imageUrl ?? item.materialImageUrl ?? null,
              ])),
            ))}
          >
            <FileDown size={16}/><span>Exportar PDF</span>
          </button>
          {quote.status === 'open' && (
            <button
              className="btn company-primary"
              type="button"
              disabled={saving || !!approvingKey}
              onClick={onAddMaterials}
            >
              <Plus size={16}/><span>Adicionar materiais</span>
            </button>
          )}
        </div>
      </header>

      {!quote.items.length || !quote.providers.length ? (
        <div className="company-empty">
          <ReceiptText size={25}/>
          <h3>Negociação indisponível</h3>
          <p>A cotação precisa ter materiais e fornecedores para receber preços.</p>
        </div>
      ) : (
        <>
          <p className="quote-negotiation-instructions" id="quote-negotiation-instructions">
            Selecione um valor para registrar uma nova versão. Depois de informar o preço, marque o fornecedor aprovado em cada linha.
          </p>
          <div
            className="quote-negotiation-matrix-wrap"
            role="region"
            aria-label="Matriz de negociação por material e fornecedor"
            aria-describedby="quote-negotiation-instructions"
            tabIndex={0}
          >
            <table
              className="quote-negotiation-matrix"
              style={{minWidth: `${280 + quote.providers.length * 190}px`}}
            >
              <caption className="sr-only">
                Materiais nas linhas e fornecedores nas colunas, com preço atual e seleção do fornecedor aprovado
              </caption>
              <thead>
                <tr>
                  <th className="quote-matrix-material-column" scope="col">Material</th>
                  {quote.providers.map(provider => (
                    <th scope="col" key={provider.id}>
                      <ProviderHeading provider={provider}/>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quote.items.map(item => {
                  const references = referenceLabel(item);
                  const material = materialById.get(item.materialId);
                  return (
                    <tr key={item.id}>
                      <th className="quote-matrix-material-column" scope="row">
                        <div className="quote-matrix-material">
                          {material ? (
                            <MaterialThumbnail material={material}/>
                          ) : (
                            <span className="quote-material-thumbnail" aria-hidden="true">
                              <PackageOpen size={23}/>
                            </span>
                          )}
                          <div className="quote-matrix-material-copy">
                            <strong>{item.materialName}</strong>
                            <small>{references || 'Sem referência cadastrada'}</small>
                            <span className="quote-matrix-material-quantity">{item.quantity} {item.unit}</span>
                          </div>
                        </div>
                      </th>
                      {quote.providers.map(provider => {
                        const currentPrice = provider.values[item.id] ?? '';
                        const currentOffer = provider.offers?.[item.id];
                        const providerHistory = negotiationHistory(quote, item.id, provider.id);
                        const approvalKey = `${item.id}:${provider.id}`;
                        const selected = approvedProviderByItem[item.id] === provider.id;
                        const approving = approvingKey === approvalKey;
                        const cannotApprove = !currentPrice || quote.status !== 'open';
                        return (
                          <td className={selected ? 'is-approved' : undefined} key={approvalKey}>
                            <button
                              className="quote-matrix-price"
                              type="button"
                              disabled={saving || !!approvingKey || quote.status !== 'open'}
                              onClick={() => setPriceEditor({
                                item,
                                provider,
                                history: providerHistory,
                                currentPrice,
                                currentOffer,
                              })}
                              aria-label={`${currentPrice ? 'Alterar' : 'Informar'} preço de ${item.materialName} para ${provider.providerName}`}
                            >
                              <span className="sr-only">Novo preço</span>
                              {currentOffer?.discountType && currentOffer.discountType !== 'none' ? (
                                <>
                                  <span className="quote-matrix-price-values">
                                    <strong>{moneyLabel(currentOffer.netUnitPrice)}</strong>
                                    <del title="Valor unitário sem desconto">{moneyLabel(currentOffer.unitPrice)}</del>
                                  </span>
                                  <small>
                                    {discountLabel(currentOffer.discountType, currentOffer.discountValue)} · total líquido {moneyLabel(currentOffer.lineTotal)}
                                  </small>
                                </>
                              ) : (
                                <>
                                  <strong>{currentPrice ? moneyLabel(currentPrice) : 'Informar preço'}</strong>
                                  <small>
                                    {providerHistory.length
                                      ? `${providerHistory.length} ${providerHistory.length === 1 ? 'versão' : 'versões'}`
                                      : 'Sem histórico'}
                                  </small>
                                </>
                              )}
                            </button>
                            {quote.status === 'open' && selected ? (
                              <button
                                className="quote-matrix-approval selected is-remove"
                                type="button"
                                disabled={saving || !!approvingKey}
                                title={`Remover a aprovação de ${provider.providerName} para ${item.materialName}`}
                                aria-label={`Remover aprovação de ${provider.providerName} para ${item.materialName}`}
                                onClick={() => void unapproveItem(item, provider)}
                              >
                                <span aria-live="polite">
                                  {approving
                                    ? <Loader2 className="animate-spin" size={13}/>
                                    : <X size={13}/>}
                                  {approving ? 'Removendo…' : 'Remover aprovação'}
                                </span>
                              </button>
                            ) : quote.status === 'open' ? (
                              <label
                                className={`quote-matrix-approval${cannotApprove ? ' disabled' : ''}`}
                                title={!currentPrice ? 'Informe um preço antes de aprovar.' : `Aprovar ${provider.providerName} para ${item.materialName}`}
                              >
                                <input
                                  type="radio"
                                  name={`approved-provider-${item.id}`}
                                  value={provider.id}
                                  checked={false}
                                  disabled={saving || !!approvingKey || cannotApprove}
                                  onChange={() => void approveItem(item, provider)}
                                />
                                <span aria-live="polite">
                                  {approving ? <Loader2 className="animate-spin" size={13}/> : null}
                                  {approving ? 'Aprovando…' : 'Aprovar'}
                                </span>
                              </label>
                            ) : selected ? (
                              <span className="quote-matrix-approved-readonly"><Check size={13}/>Aprovado</span>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="quote-matrix-totals-row">
                  <th className="quote-matrix-material-column" scope="row">
                    <strong>Totais por fornecedor</strong>
                    <small>Valores brutos e líquidos</small>
                  </th>
                  {quote.providers.map(provider => (
                    <td key={`totals:${provider.id}`}>
                      <div className="quote-matrix-provider-totals">
                        <span>
                          <small>Valor total</small>
                          <strong>{moneyLabel(provider.grossTotal ?? provider.total ?? '0')}</strong>
                        </span>
                        <span className="is-net-total">
                          <small>Valor total com desconto</small>
                          <strong>{moneyLabel(provider.total ?? '0')}</strong>
                        </span>
                        <span className="is-approved-gross-total">
                          <small>Valor aprovado</small>
                          <strong>{moneyLabel(provider.awardedGrossTotal ?? provider.awardedTotal ?? '0')}</strong>
                        </span>
                        <span className="is-approved-total is-net-total">
                          <small>Valor aprovado com desconto</small>
                          <strong>{moneyLabel(provider.awardedTotal ?? '0')}</strong>
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="quote-negotiation-approved-total" aria-live="polite">
            <span>
              <small>Valor geral aprovado</small>
              <strong>{moneyLabel(quote.awardedGrossTotal)}</strong>
            </span>
            <span className="is-net-total">
              <small>Valor geral aprovado com desconto</small>
              <strong>{moneyLabel(quote.awardedTotal)}</strong>
            </span>
            <small>{quote.awardedItemCount} de {quote.items.length} itens aprovados</small>
          </div>
          {approvalError && <p className="form-error" role="alert">{approvalError}</p>}

          <details className="quote-negotiation-history quote-negotiation-history-all">
            <summary>Histórico completo de preços ({history.length})</summary>
            {history.length ? (
              <div className="quote-history-list">
                {history.map(entry => {
                  const item = itemById.get(entry.itemId);
                  const provider = providerById.get(entry.providerId);
                  return (
                    <article className="quote-history-row" key={entry.id}>
                      <span className="quote-history-version">Versão {entry.version}</span>
                      <div className="quote-history-copy">
                        <strong>{item?.materialName || 'Material não encontrado'}</strong>
                        <small>
                          {provider?.providerName || 'Fornecedor não encontrado'} · {timestampLabel(entry.createdAt)}
                          {entry.notes ? ` · ${entry.notes}` : ''}
                        </small>
                      </div>
                      <div className="quote-history-values">
                        <strong>{moneyLabel(entry.lineTotal)}</strong>
                        <small>
                          {entry.discountType === 'none'
                            ? `Bruto unitário: ${moneyLabel(entry.unitPrice)}`
                            : `${discountLabel(entry.discountType, entry.discountValue)} · bruto unitário ${moneyLabel(entry.unitPrice)}`}
                        </small>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="quote-negotiation-history-empty">Nenhum preço registrado nesta cotação.</p>
            )}
          </details>
        </>
      )}

      {priceEditor && (
        <QuotePriceDialog
          item={priceEditor.item}
          provider={priceEditor.provider}
          currentPrice={priceEditor.currentPrice}
          currentOffer={priceEditor.currentOffer}
          history={priceEditor.history}
          saving={saving}
          onClose={() => setPriceEditor(null)}
          onSave={onRecord}
        />
      )}
      {pdf && (
        <PdfExportDialog
          snapshot={pdf}
          companyId={activeCompanyId}
          createPdf={createQuotationNegotiationPdf}
          orientation="landscape"
          fitPreviewToWidth
          showPreviewToolbar
          title="Exportar mapa de negociação"
          description={`${quote.number || quote.title} · ${quote.items.length} material(is) · ${quote.providers.length} fornecedor(es). Confira preços, descontos e aprovações antes de baixar.`}
          previewClassName="quote-negotiation-pdf-preview"
          onClose={() => setPdf(null)}
        />
      )}
    </section>
  );
}
