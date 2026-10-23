export type ImportStatus = 'open' | 'finished';
export interface ImportField {
  key: string; label: string; source: 'pdf' | 'manual' | 'fixed'; type: 'text' | 'decimal' | 'date';
  required: boolean; column: string; defaultValue: string; sourceKey?: string; pattern?: string; mappings?: Record<string,string>;
}
export interface ImportProfileInput {
  id?: string; name: string; clientId: string | null; parser: string; sheetName: string; startRow: number;
  fields: ImportField[]; templateBase64?: string; templateName?: string; expectedUpdatedAt?: string;
}
export interface ImportProfile extends Omit<ImportProfileInput,'id'|'expectedUpdatedAt'> { id: string; updatedAt: string; createdAt: string }
export interface ImportEntry {
  id: string; date: string; values: Record<string,string>; source: Record<string,string>; sourcePage: number;
  sourceLine: string; reviewed: boolean;
}
export interface ImportDocument {
  id: string; clientId: string; clientName: string; profileId: string; profileSnapshot: ImportProfile;
  sourceName: string; sourceHash: string; status: ImportStatus; entries: ImportEntry[]; entryCount: number;
  pendingCount: number; createdAt: string; updatedAt: string; finishedAt: string | null;
  dayEntryCount?: number; dayPendingCount?: number;
}
export interface ImportDocumentInput {
  id?: string; profileId: string; clientId: string; sourceName: string; sourceHash: string;
  entries: Array<Omit<ImportEntry,'id'|'reviewed'|'source'> & {source?:Record<string,string>}>;
}
export interface ImportEntryInput {
  id: string; entryId?: string; date: string; values: Record<string,string>; reviewed: boolean; expectedUpdatedAt: string;
}
export interface ImportRevisionInput { id: string; expectedUpdatedAt: string }
export interface ImportBulkInput extends ImportRevisionInput { entryIds: string[]; fieldKey?: string; fieldKeys?: string[]; value: string }
export interface ImportColumnTypeInput extends ImportRevisionInput { fieldKey?: string; fieldKeys?: string[]; type: ImportField['type'] }
export interface ImportCollection {
  clients: Array<{clientId:string; clientName:string; days:Array<{date:string; documents:ImportDocument[]}>}>;
  total: number; canManage: boolean;
}
export interface ImportExport {
  document: ImportDocument; sheetName: string; startRow: number;
  columns: Array<{key:string; column:string; label:string; type:ImportField['type']}>;
  rows: Array<{entryId:string; values:Record<string,string>}>;
}
