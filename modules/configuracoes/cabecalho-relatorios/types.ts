import type {ReportHeaderVariant,ReportOrientation} from "@/shared/reporting";

export type ReportHeaderSettings = {
  orientation: ReportOrientation;
  defaultCompanyId: string | null;
  portrait: ReportHeaderVariant;
  landscape: ReportHeaderVariant;
  updatedAt: string | null;
};

export const defaultReportHeaderVariant:ReportHeaderVariant={variant:"detailed",logoAlignment:"left",showCnpj:true,showContact:true};
export const defaultReportHeaderSettings:ReportHeaderSettings={orientation:"portrait",defaultCompanyId:null,portrait:{...defaultReportHeaderVariant},landscape:{...defaultReportHeaderVariant,variant:"compact"},updatedAt:null};

export function activeReportHeader(settings:ReportHeaderSettings){return settings[settings.orientation];}
