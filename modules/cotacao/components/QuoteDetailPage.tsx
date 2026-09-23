'use client';

import {useState} from 'react';
import {ClipboardList, DollarSign, Loader2, RefreshCw, ShoppingCart, Trash2, Users} from 'lucide-react';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {useProviders} from '@/modules/cadastro/prestadores/hooks/useProviders';
import {notifications, useConfirmation} from '@/shared/feedback';
import {ModuleLink, useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {dateLabel} from '@/shared/utils/presentation';
import {useMaterials, useQuoteDetail, useQuoteMutations} from '../hooks/useQuotes';
import type {Quote, QuoteItem, QuoteItemAwardInput, QuoteNegotiationInput, QuoteProvider} from '../types';
import {listHref, QuotationBreadcrumb} from './QuoteShared';
import {QuoteNegotiationTab} from './QuoteNegotiationTab';
import {QuoteProvidersTab} from './QuoteProvidersTab';
import {
  QuoteAddMaterialDialog,
  QuoteAddProviderDialog,
  type QuoteScopeItemInput,
  type QuoteScopeProviderInput,
} from './QuoteScopeDialogs';
import {QuoteSummaryTab} from './QuoteSummaryTab';

type QuoteDetailTab = 'summary' | 'negotiation' | 'providers';

export function QuoteDetailPage({id}: {id: string}) {
  const query = useQuoteDetail(id);
  if (query.loading) {
    return (
      <section className="cotacao-page">
        <QuotationBreadcrumb name="Detalhes"/>
        <div className="client-loading"><Loader2 className="animate-spin" size={20}/>Carregando cotação…</div>
      </section>
    );
  }
  if (query.error || !query.quote) {
    return (
      <section className="cotacao-page">
        <QuotationBreadcrumb name="Detalhes"/>
        <div className="company-empty" role="alert">
          <h3>Não foi possível carregar</h3>
          <p>{query.error || 'Cotação não encontrada.'}</p>
          <button className="btn" type="button" onClick={() => void query.reload()}>
            <RefreshCw size={16}/>Tentar novamente
          </button>
        </div>
      </section>
    );
  }
  return <QuoteDetailContent quote={query.quote}/>;
}

function QuoteDetailContent({quote}: {quote: Quote}) {
  const {navigate} = useModuleNavigation();
  const mutations = useQuoteMutations();
  const materialsQuery = useMaterials();
  const providersQuery = useProviders();
  const confirm = useConfirmation();
  const [tab, setTab] = useState<QuoteDetailTab>('summary');
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [addingProviders, setAddingProviders] = useState(false);
  const [removingItemId, setRemovingItemId] = useState('');
  const [removingProviderId, setRemovingProviderId] = useState('');
  const [finalizeError, setFinalizeError] = useState('');
  const purchaseOrders = quote.purchaseOrders ?? [];
  const singleOrderId = purchaseOrders.length === 1
    ? purchaseOrders[0].id
    : quote.purchaseOrderId;
  const orderHref = singleOrderId
    ? `/pedidos?pedido=${encodeURIComponent(singleOrderId)}`
    : '/pedidos';

  const remove = async () => {
    if (
      quote.status !== 'open'
      || quote.negotiations.length > 0
      || !await confirm({
        title: 'Excluir cotação?',
        description: 'A cotação, seus materiais e fornecedores serão removidos.',
        confirmLabel: 'Excluir',
        tone: 'destructive',
      })
    ) return;
    try {
      await mutations.remove(quote.id);
      navigate(listHref, {replace: true});
      notifications.deleted('Cotação excluída.');
    } catch (reason) {
      notifications.error((reason as Error).message || 'Não foi possível excluir a cotação.');
    }
  };

  const finalize = async () => {
    setFinalizeError('');
    if (!quote.awardComplete) {
      const message = 'Aprove um fornecedor com preço informado para cada material antes de finalizar.';
      setFinalizeError(message);
      return;
    }
    const selectedProviders = quote.providers.filter(provider => (provider.awardedItemCount ?? 0) > 0);
    const accepted = await confirm({
      title: selectedProviders.length === 1 ? 'Finalizar cotação e criar pedido?' : 'Finalizar cotação e criar pedidos?',
      description: `${quote.items.length} material(is) aprovado(s) serão distribuídos entre ${selectedProviders.length} fornecedor(es). A cotação ficará finalizada e será criado um pedido em aberto para cada fornecedor selecionado.`,
      confirmLabel: selectedProviders.length === 1 ? 'Finalizar e criar pedido' : 'Finalizar e criar pedidos',
    });
    if (!accepted) return;
    try {
      const result = await mutations.finalize({id: quote.id});
      const orders = result.purchaseOrders ?? (result.purchaseOrder ? [result.purchaseOrder] : []);
      if (!orders.length) {
        throw new Error('A cotação foi processada, mas os pedidos não foram retornados. Atualize a página e tente novamente.');
      }
      if (orders.length === 1) {
        const number = orders[0].number ? ` ${orders[0].number}` : '';
        notifications.created(`Pedido${number} criado em aberto.`);
        navigate(`/pedidos?pedido=${encodeURIComponent(orders[0].id)}`, {replace: true});
      } else {
        notifications.created(`${orders.length} pedidos criados em aberto, separados por fornecedor.`);
        navigate('/pedidos', {replace: true});
      }
    } catch (reason) {
      const message = (reason as Error).message || 'Não foi possível finalizar a cotação e criar os pedidos.';
      setFinalizeError(message);
      notifications.error(message);
    }
  };

  const recordNegotiation = async (
    input: Omit<QuoteNegotiationInput, 'id'>,
  ) => {
    try {
      await mutations.recordNegotiation({...input, id: quote.id});
      notifications.saved('Novo preço registrado. O valor anterior continua no histórico.');
    } catch (reason) {
      const message = (reason as Error).message || 'Não foi possível registrar o novo preço.';
      notifications.error(message);
      throw reason;
    }
  };

  const approveItem = async (input: Omit<QuoteItemAwardInput, 'id'>) => {
    try {
      await mutations.approveItem({...input, id: quote.id});
      setFinalizeError('');
      notifications.saved('Fornecedor aprovado para o material.');
    } catch (reason) {
      const message = (reason as Error).message || 'Não foi possível aprovar o fornecedor para o material.';
      notifications.error(message);
      throw reason;
    }
  };

  const addMaterial = async (item: QuoteScopeItemInput) => {
    try {
      await mutations.addItems({id: quote.id, items: [item]});
      notifications.created('Material adicionado sem alterar o histórico da cotação.');
    } catch (reason) {
      const message = (reason as Error).message || 'Não foi possível adicionar o material.';
      notifications.error(message);
      throw reason;
    }
  };

  const addProviders = async (providers: QuoteScopeProviderInput[]) => {
    try {
      await mutations.addProviders({id: quote.id, providers});
      notifications.created(
        providers.length === 1
          ? 'Fornecedor adicionado à cotação.'
          : `${providers.length} fornecedores adicionados à cotação.`,
      );
    } catch (reason) {
      const message = (reason as Error).message || 'Não foi possível adicionar os fornecedores.';
      notifications.error(message);
      throw reason;
    }
  };

  const removeMaterial = async (item: QuoteItem) => {
    if (quote.status !== 'open' || mutations.scopeSaving) return;
    const accepted = await confirm({
      title: 'Remover material da cotação?',
      description: `${item.materialName} será removido somente desta cotação. O cadastro do material será mantido.`,
      confirmLabel: 'Remover material',
      tone: 'destructive',
    });
    if (!accepted) return;
    setRemovingItemId(item.id);
    try {
      await mutations.removeItem({id: quote.id, quotationItemId: item.id});
      setFinalizeError('');
      notifications.deleted('Material removido da cotação.');
    } catch (reason) {
      notifications.error((reason as Error).message || 'Não foi possível remover o material da cotação.');
    } finally {
      setRemovingItemId('');
    }
  };

  const removeProvider = async (provider: QuoteProvider) => {
    if (quote.status !== 'open' || mutations.scopeSaving) return;
    const accepted = await confirm({
      title: 'Remover fornecedor da cotação?',
      description: `${provider.providerName} deixará de participar desta cotação. O cadastro do fornecedor será mantido.`,
      confirmLabel: 'Remover fornecedor',
      tone: 'destructive',
    });
    if (!accepted) return;
    setRemovingProviderId(provider.id);
    try {
      await mutations.removeProvider({id: quote.id, quotationProviderId: provider.id});
      setFinalizeError('');
      notifications.deleted('Fornecedor removido da cotação.');
    } catch (reason) {
      notifications.error((reason as Error).message || 'Não foi possível remover o fornecedor da cotação.');
    } finally {
      setRemovingProviderId('');
    }
  };

  return (
    <section className="cotacao-page quote-detail-page">
      <QuotationBreadcrumb name={quote.title}/>
      <div className="companies-heading quote-detail-heading">
        <div>
          <span className="quote-eyebrow">{quote.number || 'COTAÇÃO'}</span>
          <h2>{quote.title}</h2>
          <p>{dateLabel(quote.requestDate)} · Solicitante: {quote.requester}</p>
        </div>
        <div className="contract-detail-actions">
          {quote.status === 'open' && quote.negotiations.length === 0 ? (
            <button
              className="btn danger"
              type="button"
              disabled={mutations.saving}
              onClick={() => void remove()}
            >
              <Trash2 size={16}/>Excluir
            </button>
          ) : quote.status === 'finished' ? (
            <ModuleLink className="btn company-primary" href={orderHref}>
              <ShoppingCart size={16}/>{quote.purchaseOrderId ? 'Abrir pedido' : 'Ver pedidos'}
            </ModuleLink>
          ) : null}
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={value => setTab(value as QuoteDetailTab)}
        className="quote-detail-tabs"
      >
        <TabsList variant="line" className="quote-detail-tabs-list" aria-label="Áreas da cotação">
          <TabsTrigger value="summary" disabled={mutations.saving}>
            <ClipboardList size={16}/>Resumo
          </TabsTrigger>
          <TabsTrigger value="negotiation" disabled={mutations.saving}>
            <DollarSign size={16}/>Negociação
          </TabsTrigger>
          <TabsTrigger value="providers" disabled={mutations.saving}>
            <Users size={16}/>Fornecedores
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="quote-detail-tab-content">
          <QuoteSummaryTab
            quote={quote}
            busy={mutations.saving}
            finalizing={mutations.finalizing}
            finalizeError={finalizeError}
            onFinalize={finalize}
            onAddMaterials={() => setAddingMaterial(true)}
            onRemoveMaterial={removeMaterial}
            removingItemId={removingItemId}
          />
        </TabsContent>
        <TabsContent value="negotiation" className="quote-detail-tab-content">
          <QuoteNegotiationTab
            quote={quote}
            materials={materialsQuery.materials}
            saving={mutations.negotiating || mutations.awarding}
            onRecord={recordNegotiation}
            onApproveItem={approveItem}
            onAddMaterials={() => setAddingMaterial(true)}
          />
        </TabsContent>
        <TabsContent value="providers" className="quote-detail-tab-content">
          <QuoteProvidersTab
            quote={quote}
            onAddProviders={() => setAddingProviders(true)}
            onRemoveProvider={removeProvider}
            addingProviders={mutations.scopeSaving}
            removingProviderId={removingProviderId}
          />
        </TabsContent>
      </Tabs>

      <QuoteAddMaterialDialog
        open={addingMaterial}
        materials={materialsQuery.materials}
        existingMaterialIds={new Set(quote.items.map(item => item.materialId))}
        catalogLoading={materialsQuery.loading}
        catalogError={materialsQuery.error}
        saving={mutations.scopeSaving}
        onReloadCatalog={materialsQuery.reload}
        onClose={() => setAddingMaterial(false)}
        onSave={addMaterial}
      />
      <QuoteAddProviderDialog
        open={addingProviders}
        providers={providersQuery.data?.providers ?? []}
        existingProviderIds={new Set(quote.providers.map(provider => provider.providerId))}
        catalogLoading={providersQuery.loading}
        catalogError={providersQuery.error}
        saving={mutations.scopeSaving}
        onReloadCatalog={providersQuery.reload}
        onClose={() => setAddingProviders(false)}
        onSave={addProviders}
      />
    </section>
  );
}
