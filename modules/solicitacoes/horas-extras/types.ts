export type OvertimeEmployee={id:string;fullName:string;registrationNumber:string;jobTitle:string};
export type OvertimeRowInput={employeeId:string;hours50:string;hours100:string};
export type OvertimeRow=OvertimeRowInput & {employeeName:string;registrationNumber:string;jobTitle:string};
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
