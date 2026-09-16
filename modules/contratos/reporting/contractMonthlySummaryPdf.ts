import type {ReportCompanyBrand,ReportHeaderVariant,ReportIssuer,ReportOrientation,ReportWatermarkBrand} from '@/shared/reporting';
import type {BillingContract} from '../types';
import {createContractSummaryDocument} from './contractSummaryPdfDocument';

export type ContractMonthlyReportBrand={orientation:ReportOrientation;header:ReportHeaderVariant;company:ReportCompanyBrand|null;watermark:ReportWatermarkBrand;issuer:ReportIssuer;issuedAt:Date};

export const createContractMonthlySummaryPdf=createContractSummaryDocument;

export async function downloadContractMonthlySummaryPdf(contract:BillingContract,brand:ContractMonthlyReportBrand){
 const result=await createContractMonthlySummaryPdf(contract,brand);
 result.doc.save(result.fileName);
}

export async function printContractMonthlySummaryPdf(contract:BillingContract,brand:ContractMonthlyReportBrand,popup:Window){
 const result=await createContractMonthlySummaryPdf(contract,brand);
 result.doc.autoPrint();popup.location.href=String(result.doc.output('bloburl'));
}
