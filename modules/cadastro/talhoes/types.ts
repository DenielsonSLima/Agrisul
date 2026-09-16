import type {Farm} from '@/modules/cadastro/fazenda/types';
export type PlotInput={name:string;areaHa:string};
export type Plot=PlotInput&{id:string;farmId:string;areaUnits:number;createdAt:string;updatedAt:string};
export type FarmPlots={farm:Farm;plots:Plot[];totalUnits:number;usedUnits:number;availableUnits:number};
/** Database-calculated capacity and totals returned by billing_rpc. */
export type FarmPlotsSummary=Omit<FarmPlots,'plots'>&{
  plots:(Plot&{maxAreaHa:string})[];
  totalHa:string;
  usedHa:string;
  availableHa:string;
  usedPercent:number;
  canAddPlot:boolean;
};
