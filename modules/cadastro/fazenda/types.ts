export type FarmInput={name:string;code?:string;areaHa:string;city:string;state:string};
export type Farm=Omit<FarmInput,'areaHa'>&{areaHa:string|null;id:string;createdAt:string;updatedAt:string};
export type FarmSummary=Farm&{
  plotCount:number;
  totalHa:string|null;
  usedHa:string;
  preservedHa:string|null;
  usedPercent:number;
};
export type FarmPortfolioSummary={
  farmCount:number;
  plotCount:number;
  totalHa:string|null;
  usedHa:string;
  preservedHa:string|null;
  usedPercent:number;
};
export type FarmListData={farms:FarmSummary[];summary:FarmPortfolioSummary};
