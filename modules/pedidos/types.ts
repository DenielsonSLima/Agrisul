export type PurchaseOrderStatus = 'open' | 'finished';

export type PurchaseOrderReference = {
  brand: string;
  code: string;
};

export type PurchaseOrderItem = {
  id: string;
  quotationItemId: string;
  materialId: string;
  materialName: string;
  materialInternalCode: string;
  materialApplication: string;
  materialReferences: PurchaseOrderReference[];
  materialImageKey: string | null;
  materialImageName: string;
  materialImageUrl: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  notes: string;
};

export type PurchaseOrder = {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  quotationId: string;
  quotationNumber: string;
  quotationTitle: string;
  quotationRequester: string;
  quotationNotes: string;
  providerId: string;
  providerName: string;
  providerLegalName: string;
  providerTradeName: string;
  providerDocumentType: 'CPF' | 'CNPJ' | '';
  providerDocument: string;
  providerAddress: string;
  providerEmail: string;
  providerPhone: string;
  requestDate: string;
  createdAt: string;
  paymentMethod: string;
  paymentMethodId: string | null;
  purchaseOrderNumber: string;
  total: string;
  itemCount: number;
  items: PurchaseOrderItem[];
  finishedAt: string | null;
  updatedAt: string;
};

export type PurchaseOrderCollection = {
  orders: PurchaseOrder[];
  total: number;
  counts: {open:number;finished:number};
};

export type PurchaseOrderFilters = {
  status: PurchaseOrderStatus;
  search: string;
  dateFrom: string;
  dateTo: string;
};

export type PurchaseOrderInput = Pick<PurchaseOrder, 'id' | 'paymentMethodId' | 'purchaseOrderNumber'>;
