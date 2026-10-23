export type PurchaseStatus='open'|'ordered'|'received'|'cancelled';
export type PurchaseInput={id:string;requestedOn:string;requestNumber:string;itemType:'material'|'service';materialId:string|null;categoryId:string|null;description:string;reference:string;quantity:string;unit:string;application:string;urgent:boolean;status:PurchaseStatus;notes:string;vehicleIds:string[];expectedUpdatedAt?:string};
export type PurchaseRequest=Omit<PurchaseInput,'vehicleIds'|'expectedUpdatedAt'>&{categoryName:string;vehicles:{id:string;internalCode:string;brand:string;model:string}[];sourceKey:string;createdAt:string;updatedAt:string};
export type PurchaseFilters={search:string;status:PurchaseStatus|'all';categoryId:string;dateFrom:string;dateTo:string;page:number;pageSize:number};
export type PurchaseCollection={items:PurchaseRequest[];total:number;page:number;pageSize:number;canManage:boolean};
