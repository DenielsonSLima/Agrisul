export type OvertimeEmployee={id:string;fullName:string;registrationNumber:string;jobTitle:string};
export type OvertimeRowInput={employeeId:string;hours50:string;hours100:string};
export type OvertimeDailyEntry={date:string;startTime:string;breakStart:string;breakEnd:string;breakDuration:string;endTime:string;rate:'50'|'100';reason:string;approval:string;hours50?:string;hours100?:string};
export type OvertimeDailyAdjustment={hours50:string;hours100:string;reason:string};
export type OvertimeDaily={employeeId:string;activity:string;sector:string;entries:OvertimeDailyEntry[];adjustment:OvertimeDailyAdjustment|null;calculated50:string;calculated100:string;total50:string;total100:string;hasDailyEntries:boolean;legacyHours50:string;legacyHours100:string};
export type OvertimeRow=OvertimeRowInput & {employeeName:string;registrationNumber:string;jobTitle:string;source?:'daily'|'legacy';daily?:OvertimeDaily};
export type OvertimeInput={
 id?:string;companyId:string;dateFrom:string;dateTo:string;referenceMonth:string;sector:string;
 rows:OvertimeRowInput[];expectedUpdatedAt?:string;notes?:string;
};
export type OvertimeSummary={
 id:string;companyId:string;dateFrom:string;dateTo:string;referenceMonth:string;sector:string;
 employeeCount:number;total50:string;total100:string;createdAt:string;updatedAt:string;
 notes:string;status:'open'|'finished';finishedAt:string|null;
 canFinish:boolean;
};
export type OvertimeReport=OvertimeSummary & {rows:OvertimeRow[]};
export type OvertimeFilters={companyId:string;dateFrom?:string;dateTo?:string;search?:string;status?:'open'|'finished'};
export type OvertimeOptions={employees:OvertimeEmployee[];canManage:boolean;canRegisterEmployees:boolean};
export type OvertimeCollection={reports:OvertimeSummary[];counts:{open:number;finished:number};canManage:boolean};
export type OvertimeDetail={report:OvertimeReport;canManage:boolean};
export type OvertimeDeleteInput={companyId:string;id:string;expectedUpdatedAt:string};
export type OvertimeCreateInput={companyId:string;dateFrom:string;dateTo:string;notes:string};
export type OvertimeTotals={total50:string;total100:string};
export type OvertimeDailyInput={companyId:string;id:string;employeeId:string;expectedUpdatedAt:string;activity:string;sector:string;entries:OvertimeDailyEntry[];adjustment?:OvertimeDailyAdjustment|null};
export type OvertimeDailyResult={daily:OvertimeDaily;report:OvertimeReport};
