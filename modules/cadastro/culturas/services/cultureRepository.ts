import {getDatabase} from '@/db/client';
import {cultureNameKey} from '../utils/cultureValidation';
import type {Culture} from '../types';
export class CultureError extends Error{constructor(message:string,public status:number){super(message);}}
export async function listCultures(owner:string):Promise<Culture[]>{
  const rows=await getDatabase().prepare('SELECT c.id,c.name,s.id AS subtype_id,s.name AS subtype_name FROM cultures c LEFT JOIN culture_subtypes s ON s.culture_id=c.id WHERE c.owner_id=? ORDER BY c.name COLLATE NOCASE,s.name COLLATE NOCASE').bind(owner).all<{id:string;name:string;subtype_id:string|null;subtype_name:string|null}>();
  const map=new Map<string,Culture>();for(const row of rows.results){let item=map.get(row.id);if(!item){item={id:row.id,name:row.name,subtypes:[]};map.set(row.id,item);}if(row.subtype_id)item.subtypes.push({id:row.subtype_id,name:row.subtype_name!});}return [...map.values()];
}
export async function saveCulture(owner:string,name:string,id?:string){
  const db=getDatabase();const now=new Date().toISOString();const cultureId=id||crypto.randomUUID();
  if(id&&!await db.prepare('SELECT id FROM cultures WHERE id=? AND owner_id=?').bind(id,owner).first())throw new CultureError('Cultura não encontrada.',404);
  try{if(id)await db.prepare('UPDATE cultures SET name=?,name_key=?,updated_at=? WHERE id=? AND owner_id=?').bind(name,cultureNameKey(name),now,id,owner).run();else await db.prepare('INSERT INTO cultures(id,owner_id,name,name_key,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(cultureId,owner,name,cultureNameKey(name),now,now).run();}catch(error){if(String(error).includes('UNIQUE'))throw new CultureError('Já existe uma cultura com esse nome.',409);throw error;}
  return cultureId;
}
export async function saveSubtype(owner:string,cultureId:string,name:string,id?:string){
  const db=getDatabase();if(!await db.prepare('SELECT id FROM cultures WHERE id=? AND owner_id=?').bind(cultureId,owner).first())throw new CultureError('Cultura não encontrada.',404);
  if(id&&!await db.prepare('SELECT id FROM culture_subtypes WHERE id=? AND culture_id=?').bind(id,cultureId).first())throw new CultureError('Subtipo não encontrado nesta cultura.',404);
  const subtypeId=id||crypto.randomUUID();const now=new Date().toISOString();
  try{if(id)await db.prepare('UPDATE culture_subtypes SET name=?,name_key=?,updated_at=? WHERE id=? AND culture_id=?').bind(name,cultureNameKey(name),now,id,cultureId).run();else await db.prepare('INSERT INTO culture_subtypes(id,culture_id,name,name_key,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(subtypeId,cultureId,name,cultureNameKey(name),now,now).run();}catch(error){if(String(error).includes('UNIQUE'))throw new CultureError('Já existe um subtipo com esse nome nesta cultura.',409);throw error;}
  return subtypeId;
}
