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
export type SummarySelection = {
 contractId:string;status:string;partnerId?:string;farmId?:string;plotId?:string;
 partnerIds?:string[];contractIds?:string[];farmIds?:string[];plotIds?:string[];
};
export type SummaryFilters = SummarySelection & {from:string;to:string};
export type WeeklyContractMethod=''|'1'|'2'|'unknown';
export type WeeklyMetrics={loadCount:number;loadedVolume:string;averageAtr:string;grossAmount:string;netAmount:string;billingPending:boolean;pendingLoadCount:number};
export type WeeklySummaryData={
 range:SummaryRange;totals:WeeklyMetrics;days:(WeeklyMetrics&{date:string})[];
 contractMethods:{code:'1'|'2'|'unknown';label:string;loadCount:number;loadedVolume:string;averageAtr:string}[];
 comparison:WeeklyMetrics&{from:string;to:string;loadChangePercent:string;volumeChangePercent:string;atrChange:string;grossChangePercent:string};
 filters:SummarySelection&{companyId:string;contractMethod:WeeklyContractMethod};filterOptions:SummaryFilterOptions;
};
export type SummaryFilterOptions = {
 contracts:{id:string;clientId?:string;clientName:string;contractNumber:string;title:string;status:string}[];
 statuses:string[];
 partners?:{id:string;name:string}[];
 farms?:{id:string;name:string;plots:{id:string;name:string}[]}[];
};

export type ExecutiveFinancialMetrics = {
 loadCount:number;loadedVolume:string;billingPending:boolean;pendingLoadCount:number;
 grossAmount:string;discountAmount:string;netAmount:string;advanceAmount:string;
 receiptAmount:string;receivedAmount:string;pendingAmount:string;creditAmount:string;
};

export type ExecutiveSummaryTotals = ExecutiveFinancialMetrics & {
 contractCount:number;activeContractCount:number;farmCount:number;plotCount:number;
};

export type ExecutiveGrossVariation={grossChangePercent?:string;grossChangeFrom?:string;grossChangeReason?:'initial'|'zero-base'|'pending'|''};
export type ExecutiveSummaryMonth = ExecutiveFinancialMetrics & ExecutiveGrossVariation & {month:string};
export type ExecutiveFinancialDay=ExecutiveGrossVariation&{date:string;loadCount:number;pendingLoadCount:number;billingPending:boolean;grossAmount:string;netAmount:string;receivedAmount:string;loadedVolume?:string};
export type ExecutiveFinancialPeriod=ExecutiveFinancialDay&{endDate:string};

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
export type ExecutiveOperationalPeriod = ExecutiveOperationalTotals & {date:string;endDate:string};

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
 contractComparison?:ExecutiveContractComparison;
 averageGrossPricePerTon?:string;
 dailyProductivity?:{productionDayCount:number;averageLoadedVolume:string;averageNetAmount:string;billingPending:boolean;pendingLoadCount:number};
 financialTimeline?:ExecutiveFinancialDay[];
 financialGroupings?:{week:ExecutiveFinancialPeriod[];fortnight:ExecutiveFinancialPeriod[]};
 operationalTimeline?:ExecutiveOperationalPeriod[];
 operationalGroupings?:{week:ExecutiveOperationalPeriod[];fortnight:ExecutiveOperationalPeriod[]};
 dimensions?:{partners:ExecutiveDimension[];contractTypes:ExecutiveDimension[]};
 harvestMethods?:{code:'1'|'2'|'unknown';label:string;loadCount:number;loadedVolume:string}[];
 filters?:SummarySelection & {companyId:string;contractLabel:string;partnerLabel?:string;farmLabel?:string;plotLabel?:string};
 filterOptions?:SummaryFilterOptions;
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

export type ExecutiveDimension = {
 id:string;name:string;contractCount:number;loadCount:number;loadedVolume:string;averageAtr:string;
 netAmount:string;receivedAmount:string;pendingAmount:string;billingPending:boolean;sharePercent:string;
};

export type ExecutiveContractComparisonCode='1'|'2'|'unknown';
export type ExecutiveContractComparisonStats={
 loadedVolume:string;averageAtr:string;loadCount:number;contractCount:number;
};
export type ExecutiveContractComparisonType=ExecutiveContractComparisonStats&{
 code:ExecutiveContractComparisonCode;label:string;sharePercent:string;
};
export type ExecutiveContractComparisonClient={
 id:string;name:string;overall:ExecutiveContractComparisonStats;types:ExecutiveContractComparisonType[];
};
export type ExecutiveContractComparison={
 overall:ExecutiveContractComparisonStats;types:ExecutiveContractComparisonType[];
 clients:ExecutiveContractComparisonClient[];
 contracts:{id:string;clientId:string;typeCode:ExecutiveContractComparisonCode;typeName:string}[];
};
