export const documentFieldLabels = {
  requestNumber: 'Número da solicitação',
  companyName: 'Empresa / prestador',
  companyAddress: 'Endereço do prestador',
  serviceValue: 'Valor do serviço',
  returnDate: 'Previsão de retorno',
  notes: 'Observações',
  requesterName: 'Nome do solicitante',
  directorName: 'Nome do diretor geral',
  createdAt: 'Data e hora do registro',
  decidedAt: 'Data e hora da decisão',
  createdByName: 'Registrado por',
  status: 'Situação',
  verificationCode: 'Código de verificação',
} as const;

export type DocumentField = keyof typeof documentFieldLabels;
export type DocumentBlockType = 'text' | 'field' | 'items' | 'signature' | 'verification' | 'line';
export type DocumentFont = 'sans' | 'serif' | 'mono';
export type DocumentSignatureRole = 'requester' | 'director';
export type DocumentBlock = {
  id: string;
  type: DocumentBlockType;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  field?: DocumentField | DocumentSignatureRole;
  fontSize?: number;
  fontFamily?: DocumentFont;
  fontWeight?: 'normal' | 'bold';
  align?: 'left' | 'center' | 'right';
};
export type DocumentLayout = {page: {width: 210; height: 297}; blocks: DocumentBlock[]};
export type DocumentTemplate = {key: 'service-request'; name: string; module: 'requests'; version: number; layout: DocumentLayout; updatedAt: string | null; updatedBy?: string | null};
export type DocumentTemplateResult = {template: DocumentTemplate; canManage: boolean};
export type DocumentTemplateList = {items: DocumentTemplate[]; canManage: boolean};
export type DocumentTemplateInput = {key: 'service-request'; name: string; expectedVersion: number; layout: DocumentLayout};
export type DocumentSignatureData = {name: string; imageUrl?: string | null; hash?: string | null; timestamp?: string | null};
export type DocumentPreviewData = {
  fields: Partial<Record<DocumentField, string>>;
  items: {description: string; application: string}[];
  signatures: Partial<Record<DocumentSignatureRole, DocumentSignatureData>>;
  verification?: {code: string; url?: string; qrImageUrl?: string | null};
};

export const documentBlockLabels: Record<DocumentBlockType, string> = {
  text: 'Texto', field: 'Campo do documento', items: 'Tabela de serviços',
  signature: 'Assinatura', verification: 'Verificação / QR', line: 'Linha separadora',
};
export const documentFontFamilies: Record<DocumentFont, string> = {
  sans: 'Arial, Helvetica, sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", monospace',
};
