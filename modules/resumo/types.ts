export type SummaryContract = {
  id: string; clientName: string; contractNumber: string; title: string; status: string;
  loadedVolume: string; grossAmount: string; discountAmount: string; netAmount: string;
  receivedAmount: string; pendingAmount: string; creditAmount: string; billingPending: boolean;
};
export type SummaryData = {month: string; totals: {
  contractCount: number; activeCount: number; loadedVolume: string; billingPending: boolean;
  pendingContractCount: number; grossAmount: string; discountAmount: string; netAmount: string;
  receivedAmount: string; pendingAmount: string; creditAmount: string;
}; contracts: SummaryContract[]};
