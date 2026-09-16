export type AtrInput={year:number;month:number;monthlyGrossValue:string;monthlyNetValue:string;accumulatedGrossValue:string;accumulatedNetValue:string};
export type AtrRecord=Omit<AtrInput,'monthlyGrossValue'|'accumulatedGrossValue'|'accumulatedNetValue'>&{
  monthlyGrossValue:string|null;
  accumulatedGrossValue:string|null;
  accumulatedNetValue:string|null;
  id:string;
  createdAt:string;
  updatedAt:string;
};
export type AtrPagination={page:number;pageSize:number;total:number;totalPages:number;hasPrevious:boolean;hasNext:boolean};
export type AtrListResult={records:AtrRecord[];pagination:AtrPagination};
