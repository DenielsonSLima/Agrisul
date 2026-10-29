import type {Farm} from '@/modules/cadastro/fazenda/types';
export type PlotInput={name:string;areaHa:string};
export type Plot=PlotInput&{id:string;farmId:string;areaUnits:number;createdAt:string;updatedAt:string};
export type FarmPlots={farm:Farm;plots:Plot[];totalUnits:number;usedUnits:number;availableUnits:number};
/** Database-calculated capacity and totals returned by billing_rpc. */
export type FarmPlotsSummary=Omit<FarmPlots,'plots'|'totalUnits'|'availableUnits'>&{
  totalUnits:number|null;
  availableUnits:number|null;
  plots:(Plot&{maxAreaHa:string|null})[];
  totalHa:string|null;
  usedHa:string;
  availableHa:string|null;
  usedPercent:number;
  canAddPlot:boolean;
};
