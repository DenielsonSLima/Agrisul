export type PlanningStatus='active'|'completed'|'cancelled';

export type PlanningPeriod={
 id:string;name:string;startDate:string;endDate:string;targetAreaHa:string;
 allocatedAreaHa:string;remainingAreaHa:string;allocationCount:number;
 plantedExecutedAreaHa:string;plantingRemainingAreaHa:string;lostAreaHa:string;
 harvestTargetTons:string;harvestActualTons:string;harvestRemainingTons:string;harvestPercent:string;harvestScopeCount:number;
 cultureId:string;cultureName:string;cultureSubtypeId:string;cultureSubtypeName:string;
 notes:string;status:PlanningStatus;revision:number;createdAt:string;updatedAt:string;
};

export type PlanningAllocation={
 id:string;periodId:string;farmId:string;farmName:string;plotId:string;plotName:string;
 areaHa:string;executedAreaHa:string;remainingExecutionAreaHa:string;notes:string;status:'active'|'cancelled';revision:number;
 practiceIds:string[];practiceNames:string[];createdAt:string;updatedAt:string;
};

export type PlanningPlot={
 id:string;name:string;areaHa:string;plantedAreaHa:string;otherPlannedAreaHa:string;
 maxAllocationAreaHa:string;harvestSelected:boolean;allocation:PlanningAllocation|null;
};

export type PlanningFarm={
 id:string;name:string;city:string;state:string;totalAreaHa:string;plotAreaHa:string;
 unmappedAreaHa:string;plantedAreaHa:string;plannedAreaHa:string;remainingPlannedAreaHa:string;plots:PlanningPlot[];
};

export type PlanningPractice={
 id:string;name:string;description:string;category:string;cultureId:string;cultureSubtypeId:string;
};

export type PlanningHistory={
 id:string;periodId:string|null;allocationId:string|null;entityType:'period'|'allocation'|'plot'|'management'|'field-log'|'harvest-goal';
 action:'created'|'updated'|'cancelled'|'remanejado'|'planted-area'|'management'|'logged'|'voided';
 reason:string;snapshot:Record<string,unknown>;createdBy:string;createdByName:string;createdAt:string;
};

export type PlanningFieldLogMaterial={code:string;description:string;quantity:string;unit:string;recommendedDose:string};
export type PlanningFieldLogDetails={
 operatorName:string;responsibleName:string;shift:string;startedAt:string;endedAt:string;
 applicationNumber:string;serviceOrderNumber:string;applicationServiceOrderNumber:string;laborDescription:string;
 equipmentCode:string;equipmentDescription:string;implementCode:string;implementDescription:string;
 hourMeterStart:string;hourMeterEnd:string;areaScope:''|'total'|'partial';materials:PlanningFieldLogMaterial[];
};

export type PlanningFieldLog={
 id:string;periodId:string;allocationId:string|null;farmId:string;farmName:string;plotId:string;plotName:string;
 occurredOn:string;kind:'planting'|'management'|'loss';practiceId:string;practiceName:string;areaHa:string;notes:string;
 details:PlanningFieldLogDetails;
 createdBy:string;createdByName:string;createdAt:string;voidedAt:string|null;voidedBy:string|null;voidReason:string;
};

export type PlanningHarvestLoad={
 id:string;contractId:string;contractNumber:string;farmId:string;farmName:string;plotId:string;plotName:string;
 loadedAt:string;volumeTons:string;document:string;notes:string;
};

export type PlanningDailySummary={
 date:string;plantedAreaHa:string;managedAreaHa:string;lostAreaHa:string;harvestedTons:string;loadCount:number;eventCount:number;
 accumulatedPlantedAreaHa:string;accumulatedManagedAreaHa:string;accumulatedLostAreaHa:string;
 accumulatedHarvestedTons:string;accumulatedLoadCount:number;
};
export type PlanningMonthlySummary={
 month:string;plantedAreaHa:string;managedAreaHa:string;lostAreaHa:string;harvestedTons:string;loadCount:number;
 accumulatedPlantedAreaHa:string;accumulatedManagedAreaHa:string;accumulatedLostAreaHa:string;
 accumulatedHarvestedTons:string;accumulatedLoadCount:number;
};
export type PlanningDiaryPeriodSummary={
 dateFrom:string;dateTo:string;plantedAreaHa:string;managedAreaHa:string;lostAreaHa:string;
 harvestedTons:string;fieldLogCount:number;loadCount:number;eventCount:number;
};

export type PlanningHarvestComparisonPlot={
 plotId:string;plotName:string;targetAreaHa:string;plantedAreaHa:string;remainingAreaHa:string;
 plantingPercent:string;targetTons:string;harvestedTons:string;remainingTons:string;harvestPercent:string;harvestLoadCount:number;
};

export type PlanningHarvestComparisonFarm={
 farmId:string;farmName:string;targetAreaHa:string;plantedAreaHa:string;remainingAreaHa:string;
 plantingPercent:string;targetTons:string;harvestedTons:string;remainingTons:string;harvestPercent:string;
 harvestLoadCount:number;plots:PlanningHarvestComparisonPlot[];
};

export type PlanningSection='seasons'|'resumo'|'metas'|'areas'|'diario'|'historico';
export type PlanningPagination={page:number;pageSize:number;total:number;totalPages:number;hasPrevious:boolean;hasNext:boolean};
export type PlanningQuery={periodId:string;search:string;page:number;pageSize:number;section:PlanningSection;dateFrom:string;dateTo:string};

export type PlanningSnapshot={
 periods:PlanningPeriod[];farms:PlanningFarm[];practices:PlanningPractice[];history:PlanningHistory[];
 fieldLogs:PlanningFieldLog[];harvestLoads:PlanningHarvestLoad[];dailySummary:PlanningDailySummary[];
 monthlySummary:PlanningMonthlySummary[];diaryPeriodSummary:PlanningDiaryPeriodSummary;
 harvestPlotIds:string[];harvestComparison:PlanningHarvestComparisonFarm[];
 visiblePeriodIds:string[];visibleFarmIds:string[];visibleFieldLogIds:string[];visibleHarvestLoadIds:string[];visibleHistoryIds:string[];
 pagination:PlanningPagination;
};

export type PlanningExportKind='planning'|'diary';
export type PlanningExportSnapshot={data:PlanningSnapshot;period:PlanningPeriod;companyId:string;kind:PlanningExportKind};

export type PlanningPeriodInput={
 name:string;startDate:string;endDate:string;targetAreaHa:string;cultureId:string;
 cultureSubtypeId:string;notes:string;status:PlanningStatus;revisionReason?:string;
};

export type PlanningAllocationInput={areaHa:string;notes:string;revisionReason?:string};

export type PlanningMutation=
 |{action:'save-period';input:PlanningPeriodInput;id?:string;expectedRevision?:number}
 |{action:'save-allocation';periodId:string;plotId:string;input:PlanningAllocationInput;id?:string;expectedRevision?:number}
 |{action:'cancel-allocation';id:string;expectedRevision:number;reason:string}
 |{action:'remanejar';allocationId:string;targetPlotId:string;areaHa:string;expectedRevision:number;reason:string}
 |{action:'set-practices';allocationId:string;practiceIds:string[];expectedRevision:number;reason?:string}
 |{action:'set-planted';plotId:string;plantedAreaHa:string;reason:string}
 |{action:'save-harvest-goal';periodId:string;targetTons:string;targets:{plotId:string;targetTons:string}[];expectedRevision:number;reason:string}
 |{action:'save-field-log';periodId:string;plotId:string;kind:'planting'|'management'|'loss';practiceId:string;occurredOn:string;areaHa:string;notes:string;requestId:string;details:PlanningFieldLogDetails}
 |{action:'void-field-log';id:string;reason:string};
