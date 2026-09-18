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

export type SummaryRange = {from:string;to:string;dayCount:number;generatedAt:string};

export type ExecutiveFinancialMetrics = {
 loadCount:number;loadedVolume:string;billingPending:boolean;pendingLoadCount:number;
 grossAmount:string;discountAmount:string;netAmount:string;advanceAmount:string;
 receiptAmount:string;receivedAmount:string;pendingAmount:string;creditAmount:string;
};

export type ExecutiveSummaryTotals = ExecutiveFinancialMetrics & {
 contractCount:number;activeContractCount:number;farmCount:number;plotCount:number;
};

export type ExecutiveSummaryMonth = ExecutiveFinancialMetrics & {month:string};

export type ExecutiveSummaryComparison = {
 from:string;to:string;loadCount:number;loadedVolume:string;netAmount:string;receivedAmount:string;
 volumeChangePercent:string;netChangePercent:string;receivedChangePercent:string;
};

export type ExecutiveSummaryContract = {
 id:string;clientName:string;contractNumber:string;title:string;status:string;loadCount:number;
 loadedVolume:string;billingPending:boolean;grossAmount:string;discountAmount:string;
 netAmount:string;receivedAmount:string;pendingAmount:string;
};

export type ExecutiveSummaryFarm = {
 id:string;name:string;areaHa:string;plotCount:number;loadCount:number;loadedVolume:string;
 billingPending:boolean;grossAmount:string;discountAmount:string;netAmount:string;
};

export type ExecutiveOperationalTotals = {
 loadCount:number;loadedVolume:string;averageAtr:string;averageLoadVolume:string;
 contractCount:number;farmCount:number;plotCount:number;
};

export type ExecutiveMonthlyOperation = ExecutiveOperationalTotals & {month:string};

export type ExecutiveFarmPerformance = {
 id:string;name:string;areaHa:string;loadCount:number;loadedVolume:string;averageAtr:string;
 averageLoadVolume:string;tonsPerHa:string;plotCount:number;contractCount:number;
};

export type ExecutivePlotPerformance = {
 id:string;name:string;farmId:string;farmName:string;areaHa:string;loadCount:number;loadedVolume:string;
 averageAtr:string;averageLoadVolume:string;tonsPerHa:string;contractCount:number;
};

export type ExecutiveContractPerformance = {
 id:string;clientName:string;contractNumber:string;title:string;status:string;contractedVolume:string;
 periodLoadCount:number;periodLoadedVolume:string;averageAtr:string;averageLoadVolume:string;
 totalLoadedVolume:string;remainingVolume:string;deliveryPercent:string;
};

export type ExecutivePlanningFarmPerformance = {
 id:string;name:string;plotCount:number;targetAreaHa:string;plantedAreaHa:string;plantingPercent:string;
 targetTons:string;harvestedTons:string;remainingTons:string;harvestPercent:string;loadCount:number;
};

export type ExecutivePlanningPlotPerformance = {
 id:string;name:string;farmId:string;farmName:string;areaHa:string;targetAreaHa:string;plantedAreaHa:string;
 plantingPercent:string;targetTons:string;harvestedTons:string;remainingTons:string;harvestPercent:string;loadCount:number;
};

export type ExecutivePlanningSummary = {
 scope:'workspace';periodCount:number;activePeriodCount:number;periodName:string;progressAsOf:string;
 targetAreaHa:string;allocatedAreaHa:string;
 plantedAreaHa:string;managedAreaHa:string;lostAreaHa:string;fieldLogCount:number;managementEventCount:number;
 harvestTargetTons:string;harvestedTons:string;plantingPercent:string;harvestPercent:string;
};

export type ExecutiveSummaryData = {
 range:SummaryRange;totals:ExecutiveSummaryTotals;comparison:ExecutiveSummaryComparison;
 months:ExecutiveSummaryMonth[];contractStatus:{status:string;count:number}[];
 contracts:ExecutiveSummaryContract[];farms:ExecutiveSummaryFarm[];
 agriculture:{scope:'workspace';registeredFarmCount:number;registeredPlotCount:number;farmAreaHa:string;plotAreaHa:string};
 planning:ExecutivePlanningSummary;
 management:{id:string;name:string;eventCount:number;areaHa:string}[];
 operationalTotals:ExecutiveOperationalTotals;monthlyOperations:ExecutiveMonthlyOperation[];
 farmPerformance:ExecutiveFarmPerformance[];plotPerformance:ExecutivePlotPerformance[];
 contractPerformance:ExecutiveContractPerformance[];
 planningPerformance:{periodName:string;farms:ExecutivePlanningFarmPerformance[];plots:ExecutivePlanningPlotPerformance[]};
};

export type ExecutiveSummarySnapshot = {data:ExecutiveSummaryData;companyId:string};
