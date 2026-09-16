import {hectaresToUnits} from "@/shared/utils/hectares";
import {getDatabase} from '@/db/client';
import type {Farm,FarmInput} from '../types';
type Row={id:string;name:string;area_ha:string;city:string;state:string;created_at:string;updated_at:string};
const present=(row:Row):Farm=>({id:row.id,name:row.name,areaHa:row.area_ha,city:row.city,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at});
export class FarmError extends Error{constructor(message:string,public status:number){super(message);}}
export async function listFarms(owner:string){const result=await getDatabase().prepare('SELECT id,name,area_ha,city,state,created_at,updated_at FROM farms WHERE owner_id=? ORDER BY name COLLATE NOCASE').bind(owner).all<Row>();return result.results.map(present);}
export async function saveFarm(owner:string,input:FarmInput,id?:string):Promise<Farm>{
  const db=getDatabase();const now=new Date().toISOString();const farmId=id||crypto.randomUUID();
  const existing=id?await db.prepare('SELECT id,created_at FROM farms WHERE id=? AND owner_id=?').bind(id,owner).first<{id:string;created_at:string}>():null;
  if(id&&!existing)throw new FarmError('Fazenda não encontrada.',404);
  if(id){const result=await db.prepare('UPDATE farms SET name=?,area_ha=?,city=?,state=?,updated_at=? WHERE id=? AND owner_id=? AND ?>=COALESCE((SELECT SUM(area_units) FROM farm_plots WHERE farm_id=farms.id),0)').bind(input.name,input.areaHa,input.city,input.state,now,id,owner,hectaresToUnits(input.areaHa)).run();if(result.meta.changes===0)throw new FarmError('A área da fazenda não pode ser menor que a soma dos talhões cadastrados.',409);}
  else await db.prepare('INSERT INTO farms(id,owner_id,name,area_ha,city,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(farmId,owner,input.name,input.areaHa,input.city,input.state,now,now).run();
  return {id:farmId,...input,createdAt:existing?.created_at||now,updatedAt:now};
}
