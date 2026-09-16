import {getDatabase} from '@/db/client';
import type {AtrInput,AtrRecord} from '../types';
type Row={id:string;year:number;month:number;value:string;created_at:string;updated_at:string};
const present=(row:Row):AtrRecord=>({id:row.id,year:row.year,month:row.month,monthlyGrossValue:null,monthlyNetValue:row.value,accumulatedGrossValue:null,accumulatedNetValue:null,createdAt:row.created_at,updatedAt:row.updated_at});
export class AtrError extends Error{constructor(message:string,public status:number){super(message);}}
export async function listAtr(owner:string){const data=await getDatabase().prepare('SELECT id,year,month,value,created_at,updated_at FROM atr_records WHERE owner_id=? ORDER BY year DESC,month ASC').bind(owner).all<Row>();return data.results.map(present);}
export async function saveAtr(owner:string,input:AtrInput,id?:string){
  const db=getDatabase();const now=new Date().toISOString();const recordId=id||crypto.randomUUID();
  const existing=id?await db.prepare('SELECT id,created_at FROM atr_records WHERE owner_id=? AND id=?').bind(owner,id).first<{id:string;created_at:string}>():null;
  if(id&&!existing)throw new AtrError('Registro não encontrado.',404);
  try{
    if(id)await db.prepare('UPDATE atr_records SET year=?,month=?,value=?,updated_at=? WHERE owner_id=? AND id=?').bind(input.year,input.month,input.monthlyNetValue,now,owner,id).run();
    else await db.prepare('INSERT INTO atr_records(id,owner_id,year,month,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(recordId,owner,input.year,input.month,input.monthlyNetValue,now,now).run();
  }catch(error){if(String(error).includes('UNIQUE'))throw new AtrError('Este mês já está cadastrado nesse ano. Abra o registro para editar o valor.',409);throw error;}
  return {id:recordId,...input,createdAt:existing?.created_at||now,updatedAt:now};
}
