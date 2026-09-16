import {getDatabase} from '@/db/client';
import {hectaresUnitsSql} from '@/db/hectaresSql';
import {hectaresToUnits,unitsToHectares} from '@/shared/utils/hectares';
import type {FarmPlots,Plot,PlotInput} from '../types';
export class PlotError extends Error{constructor(message:string,public status:number){super(message);}}
type Row={farm_id:string;farm_name:string;farm_area:string;city:string;state:string;farm_created:string;farm_updated:string;id:string|null;name:string|null;area_units:number|null;created_at:string|null;updated_at:string|null};
export async function getFarmPlots(owner:string,farmId:string):Promise<FarmPlots>{
  const result=await getDatabase().prepare('SELECT f.id AS farm_id,f.name AS farm_name,f.area_ha AS farm_area,f.city,f.state,f.created_at AS farm_created,f.updated_at AS farm_updated,p.id,p.name,p.area_units,p.created_at,p.updated_at FROM farms f LEFT JOIN farm_plots p ON p.farm_id=f.id WHERE f.id=? AND f.owner_id=? ORDER BY p.name COLLATE NOCASE').bind(farmId,owner).all<Row>();
  const first=result.results[0];if(!first)throw new PlotError('Fazenda não encontrada.',404);
  const farm={id:first.farm_id,name:first.farm_name,areaHa:first.farm_area,city:first.city,state:first.state,createdAt:first.farm_created,updatedAt:first.farm_updated};
  const plots:Plot[]=result.results.filter(row=>row.id!==null).map(row=>({id:row.id!,farmId,name:row.name!,areaUnits:row.area_units!,areaHa:unitsToHectares(row.area_units!),createdAt:row.created_at!,updatedAt:row.updated_at!}));
  const totalUnits=hectaresToUnits(farm.areaHa);const usedUnits=plots.reduce((sum,plot)=>sum+plot.areaUnits,0);
  return {farm,plots,totalUnits,usedUnits,availableUnits:totalUnits-usedUnits};
}
export async function savePlot(owner:string,farmId:string,input:PlotInput,id?:string){
  const db=getDatabase();const current=await getFarmPlots(owner,farmId);
  if(id&&!current.plots.some(plot=>plot.id===id))throw new PlotError('Talhão não encontrado nesta fazenda.',404);
  const units=hectaresToUnits(input.areaHa);const now=new Date().toISOString();
  let result:D1Result;
  try {
    // The capacity predicate and write are one atomic statement, including concurrent requests.
    if(id)result=await db.prepare(`UPDATE farm_plots SET name=?,area_units=?,updated_at=? WHERE id=? AND farm_id=? AND EXISTS(SELECT 1 FROM farms f WHERE f.id=? AND f.owner_id=? AND ?+COALESCE((SELECT SUM(area_units) FROM farm_plots WHERE farm_id=? AND id<>?),0)<=${hectaresUnitsSql('f.area_ha')})`).bind(input.name,units,now,id,farmId,farmId,owner,units,farmId,id).run();
    else result=await db.prepare(`INSERT INTO farm_plots(id,farm_id,name,area_units,created_at,updated_at) SELECT ?,f.id,?,?,?,? FROM farms f WHERE f.id=? AND f.owner_id=? AND ?+COALESCE((SELECT SUM(area_units) FROM farm_plots WHERE farm_id=f.id),0)<=${hectaresUnitsSql('f.area_ha')}`).bind(crypto.randomUUID(),input.name,units,now,now,farmId,owner,units).run();
  }catch(error){if(String(error).includes('UNIQUE'))throw new PlotError('Já existe um talhão com esse nome nesta fazenda.',409);throw error;}
  if(result.meta.changes===0)throw new PlotError('A soma dos talhões não pode ultrapassar a área da fazenda. Confira a área disponível.',409);
  return getFarmPlots(owner,farmId);
}
