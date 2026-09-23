export const MATERIALS_PAGE_SIZE=20;

export type MaterialsPagination<T>={
 items:T[];
 page:number;
 pageSize:number;
 total:number;
 totalPages:number;
 firstItem:number;
 lastItem:number;
 hasPrevious:boolean;
 hasNext:boolean;
};

export function parseMaterialsPage(value:string|null){
 if(!value||!/^\d+$/.test(value))return 1;
 const page=Number(value);
 return Number.isSafeInteger(page)&&page>0?page:1;
}

export function paginateMaterials<T>(items:readonly T[],requestedPage:number):MaterialsPagination<T>{
 const total=items.length;
 const totalPages=Math.max(1,Math.ceil(total/MATERIALS_PAGE_SIZE));
 const page=Math.min(Math.max(Number.isSafeInteger(requestedPage)?requestedPage:1,1),totalPages);
 const start=(page-1)*MATERIALS_PAGE_SIZE;
 const pagedItems=items.slice(start,start+MATERIALS_PAGE_SIZE);
 return {
  items:pagedItems,
  page,
  pageSize:MATERIALS_PAGE_SIZE,
  total,
  totalPages,
  firstItem:total?start+1:0,
  lastItem:total?start+pagedItems.length:0,
  hasPrevious:page>1,
  hasNext:page<totalPages,
 };
}
