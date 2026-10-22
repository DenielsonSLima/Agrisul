export const documentKinds = {
  service_request: 'Solicitação de serviço', purchase_request: 'Solicitação de compras',
  invoice: 'Nota fiscal', budget: 'Orçamento', boleto: 'Boleto', payment: 'Comprovante de pagamento',
  delivery: 'Comprovante de entrega', photo: 'Foto', other: 'Outro documento',
} as const;
export const documentStatuses = {review: 'A conferir', verified: 'Conferido', divergent: 'Com divergência', cancelled: 'Cancelado', replaced: 'Substituído'} as const;
export type DocumentKind = keyof typeof documentKinds;
export type DocumentStatus = keyof typeof documentStatuses;
export type SourceType = 'service' | 'quotation' | 'order';
export type DocumentSource = {type: SourceType; id: string; label: string; description: string; href: string; providerId: string | null; quotationId?: string};
export type SourceReference = Pick<DocumentSource, 'type' | 'id'>;
export type DocumentFile = {id: string; bucket: string; path: string; fileName: string; contentType: string; size: number};
export type BillingDocument = {
  id: string; kind: DocumentKind; title: string; documentNumber: string; issuedOn: string | null; dueOn: string | null;
  amount: string | null; providerId: string | null; providerName: string | null; providerDocument: string | null;
  companyId: string | null; companyName: string | null; parentId: string | null; parentTitle: string | null;
  replacementId: string | null; status: DocumentStatus; notes: string; reviewNote: string; revision: number;
  createdAt: string; updatedAt: string; sources: DocumentSource[]; files: DocumentFile[];
};
export type DocumentInput = {
  id: string; expectedRevision: number; kind: DocumentKind; title: string; documentNumber: string; issuedOn: string;
  dueOn: string; amount: string; providerId: string; companyId: string; parentId: string; notes: string;
  sources: SourceReference[]; fileIds: string[];
};
export type DocumentOptions = {canManage: boolean; providers: {id: string; name: string; document: string}[]; companies: {id: string; name: string}[]};
export type DocumentExpectation = {id: string; kind: DocumentKind; required: boolean; dueOn: string | null; notes: string};
export type ExpectationInput = {source: SourceReference; kind: DocumentKind; required: boolean; dueOn: string; notes: string};
export type DocumentPending = {id: string; kind: DocumentKind; reason: 'missing' | 'review' | 'divergent' | 'unlinked'; source: DocumentSource | null; documentId: string | null; title: string; notes: string; dueOn: string | null; overdue: boolean};
export type DocumentFilters = {search: string; kind: string; status: string; providerId: string; dateFrom: string; dateTo: string; page: number; includePending?: boolean; sourceCategory?: '' | 'service' | 'purchase'};
export type DocumentCollection = {documents: BillingDocument[]; total: number; page: number; pageSize: number; pending: DocumentPending[]; pendingTotal: number; canManage: boolean};
export type DocumentContext = {source: DocumentSource; documents: BillingDocument[]; expectations: DocumentExpectation[]; existingFiles: DocumentFile[]; canManage: boolean};
export type DocumentDetail = {document: BillingDocument; children: BillingDocument[]; canManage: boolean; history: {id: string; action: string; actorName: string; at: string; details: {document: BillingDocument}}[]};
export type DocumentExecution = {actorId: string; signal: AbortSignal};
export type DocumentReview = {id: string; expectedRevision: number; status: DocumentStatus; note: string; replacementId: string};
export const emptyDocumentFilters: DocumentFilters = {search: '', kind: '', status: '', providerId: '', dateFrom: '', dateTo: '', page: 1};
