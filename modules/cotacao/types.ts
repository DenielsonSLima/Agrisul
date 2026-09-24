export type QuoteStatus = 'open' | 'finished';

export type MaterialReference = {
  id: string;
  materialId: string;
  brand: string;
  code: string;
  createdAt: string;
};

export type Material = {
  id: string;
  name: string;
  internalCode: string;
  categoryId: string | null;
  categoryName: string;
  unit: string;
  application: string;
  imageKey: string | null;
  imageName: string;
  imageUrl: string | null;
  references: MaterialReference[];
  createdAt: string;
};

export type QuoteItem = {
  id: string;
  materialId: string;
  materialVariantId: string | null;
  materialName: string;
  materialCode: string;
  materialApplication: string;
  materialReferences: Pick<MaterialReference,'brand'|'code'>[];
  materialImageKey?: string | null;
  materialImageName?: string;
  materialImageUrl?: string | null;
  quantity: string;
  unit: string;
  notes: string;
  canRemove?: boolean;
  removeBlockedReason?: string;
};

export type QuoteProvider = {
  id: string;
  providerId: string;
  providerName: string;
  providerDocumentType?: 'CPF' | 'CNPJ';
  providerDocument?: string;
  providerTradeName?: string;
  providerEmail?: string;
  providerPhone?: string;
  values: Record<string,string>;
  notes: string;
  sentAt: string | null;
  total?: string;
  quotedItemCount?: number;
  isComplete?: boolean;
  awardedItemCount?: number;
  awardedTotal?: string;
  canRemove?: boolean;
  removeBlockedReason?: string;
};

export type QuoteNegotiation = {
  id: string;
  requestId: string;
  providerId: string;
  itemId: string;
  version: number;
  unitPrice: string;
  notes: string;
  createdAt: string;
};

export type QuoteItemAward = {
  itemId: string;
  providerId: string;
  unitPrice: string;
  lineTotal: string;
  awardedAt: string;
  updatedAt: string;
};

export type Quote = {
  id: string;
  title: string;
  number: string;
  requestDate: string;
  requester: string;
  requesterSignatureId?: string | null;
  notes: string;
  createdAt: string;
  status: QuoteStatus;
  items: QuoteItem[];
  providers: QuoteProvider[];
  negotiations: QuoteNegotiation[];
  itemAwards: QuoteItemAward[];
  awardedItemCount: number;
  completeProviderCount: number;
  pendingAwardCount: number;
  awardComplete: boolean;
  winningProviderIds: string[];
  winnerProviderId?: string | null;
  purchaseOrderId?: string | null;
  purchaseOrders: QuotePurchaseOrder[];
};

export type QuotePurchaseOrder = {
  id: string;
  number: string;
  quotationProviderId: string;
  providerId: string;
  providerName: string;
  total: string;
};

export type QuoteFinalizeInput = {
  id: string;
  /** Legacy single-winner fallback. New flows persist one item award at a time. */
  winnerProviderId?: string;
};

export type QuoteFinalizeResult = {
  quote: Quote;
  purchaseOrders: QuotePurchaseOrder[];
  purchaseOrder: QuotePurchaseOrder | null;
};

export type QuoteItemAwardInput = {
  id: string;
  quotationItemId: string;
  quotationProviderId: string;
};

export type QuoteScopeItemInput = Pick<QuoteItem, 'id' | 'materialId' | 'quantity' | 'notes'>;
export type QuoteScopeProviderInput = Pick<QuoteProvider, 'id' | 'providerId' | 'notes' | 'sentAt'>;
export type QuoteAddItemsInput = { id: string; items: QuoteScopeItemInput[] };
export type QuoteAddProvidersInput = { id: string; providers: QuoteScopeProviderInput[] };
export type QuoteRemoveItemInput = { id: string; quotationItemId: string };
export type QuoteRemoveProviderInput = { id: string; quotationProviderId: string };
export type QuoteDetailsInput = {
  id: string;
  title: string;
  requestDate: string;
  requesterSignatureId: string;
  notes: string;
};

export type QuoteNegotiationInput = {
  id: string;
  requestId: string;
  quotationProviderId: string;
  quotationItemId: string;
  unitPrice: string;
  notes: string;
};

export type MaterialInput = Pick<Material, 'name' | 'internalCode' | 'unit' | 'application'> & { id?: string; categoryId?: string | null };
export type MaterialReferenceInput = Pick<MaterialReference, 'materialId' | 'brand' | 'code'> & { id?: string };
export type MaterialImageChange = {
  file: File | null;
  remove: boolean;
  previousKey: string | null;
};
export type QuoteInput = {
  id?: string;
  title: string;
  number: string;
  requestDate: string;
  requester: string;
  requesterSignatureId?: string;
  notes: string;
  items: QuoteItem[];
  providers: QuoteProvider[];
};
