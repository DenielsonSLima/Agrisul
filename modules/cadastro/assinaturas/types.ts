export type SignatureRole = 'requester' | 'manager';
export type SignatureStatus = 'active' | 'inactive' | 'all';

export type Signature = {
  id: string;
  name: string;
  userId: string | null;
  role: SignatureRole;
  fileId: string | null;
  filePath: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SignatureFilters = {search: string; page: number; pageSize: number; status: SignatureStatus};
export type SignatureList = {items: Signature[]; total: number; page: number; pageSize: number};
export type SignatureOptions = {users: {id: string; name: string}[]; canManage: boolean};
export type SignatureInput = {id?: string; name: string; userId?: string | null; role: SignatureRole; file?: File; removeImage?: boolean};
export type SignatureUpload = {id: string; bucket: string; path: string; fileName: string; contentType: string; size: number};

export const signatureRoleLabels: Record<SignatureRole, string> = {requester: 'Solicitante', manager: 'Diretor geral'};
