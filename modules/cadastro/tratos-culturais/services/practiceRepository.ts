import {getDatabase} from '@/db/client';
import {practiceNameKey,type LegacyPracticeInput} from '../utils/practiceValidation';
type Row={id:string;name:string;description:string;created_at:string;updated_at:string};
type LegacyPractice=LegacyPracticeInput&{id:string;createdAt:string;updatedAt:string};
export class PracticeError extends Error{constructor(message:string,public status:number){super(message);}}
export async function listPractices(owner:string):Promise<LegacyPractice[]>{
  const rows=await getDatabase().prepare('SELECT id,name,description,created_at,updated_at FROM cultural_practices WHERE owner_id=? ORDER BY name COLLATE NOCASE').bind(owner).all<Row>();
  return rows.results.map(r=>({id:r.id,name:r.name,description:r.description,createdAt:r.created_at,updatedAt:r.updated_at}));
}
export async function savePractice(owner:string,input:LegacyPracticeInput,id?:string):Promise<LegacyPractice>{
  const db=getDatabase();const existing=id?await db.prepare('SELECT id,created_at FROM cultural_practices WHERE id=? AND owner_id=?').bind(id,owner).first<{id:string;created_at:string}>():null;
  if(id&&!existing)throw new PracticeError('Manejo não encontrado.',404);
  const now=new Date().toISOString();const recordId=id||crypto.randomUUID();
  try{
    if(id)await db.prepare('UPDATE cultural_practices SET name=?,name_key=?,description=?,updated_at=? WHERE id=? AND owner_id=?').bind(input.name,practiceNameKey(input.name),input.description,now,id,owner).run();
    else await db.prepare('INSERT INTO cultural_practices(id,owner_id,name,name_key,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(recordId,owner,input.name,practiceNameKey(input.name),input.description,now,now).run();
  }catch(error){if(String(error).includes('UNIQUE'))throw new PracticeError('Já existe um manejo com esse nome.',409);throw error;}
  return {id:recordId,...input,createdAt:existing?.created_at||now,updatedAt:now};
}
