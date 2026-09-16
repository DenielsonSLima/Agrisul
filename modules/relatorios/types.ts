import type {ReportPdfBrand} from '@/shared/reporting';
export type ReportKind = 'contracts' | 'loads' | 'financial' | 'farms';
export type ReportValue = string | number | boolean | null;
export type ReportData = {kind: ReportKind; scope: 'company' | 'workspace'; month?: string; total: number; rows: Record<string, ReportValue>[]; totals: Record<string, ReportValue>};
export type ReportColumn = {key: string; label: string; format?: 'money' | 'decimal' | 'date'; width: number};
export type ReportSnapshot = {data: ReportData; month: string; companyId: string};
export type ReportBrand = ReportPdfBrand;
