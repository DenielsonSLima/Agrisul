export type FarmInput={name:string;areaHa:string;city:string;state:string};
export type Farm=FarmInput&{id:string;createdAt:string;updatedAt:string};
export type FarmSummary=Farm&{
  plotCount:number;
  totalHa:string;
  usedHa:string;
  preservedHa:string;
  usedPercent:number;
};
export type FarmPortfolioSummary={
  farmCount:number;
  plotCount:number;
  totalHa:string;
  usedHa:string;
  preservedHa:string;
  usedPercent:number;
};
export type FarmListData={farms:FarmSummary[];summary:FarmPortfolioSummary};
