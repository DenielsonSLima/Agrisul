import {getDatabase} from '@/db/client';
import {typeNameKey} from '../utils/typeValidation';
import type {ContractType,ContractTypeInput} from '../types';
type Row={id:string;name:string;stages_json:string;created_at:string;updated_at:string};
const columns='id,name,stages_json,created_at,updated_at';
const present=(r:Row):ContractType=>({id:r.id,name:r.name,stages:JSON.parse(r.stages_json),createdAt:r.created_at,updatedAt:r.updated_at});
export class ContractTypeError extends Error{constructor(message:string,public status:number){super(message);}}
export async function listContractTypes(owner:string){const rows=await getDatabase().prepare(`SELECT ${columns} FROM contract_types WHERE owner_id=? ORDER BY name COLLATE NOCASE`).bind(owner).all<Row>();return rows.results.map(present);}
export async function getContractType(owner:string,id:string){const row=await getDatabase().prepare(`SELECT ${columns} FROM contract_types WHERE owner_id=? AND id=?`).bind(owner,id).first<Row>();if(!row)throw new ContractTypeError('Tipo de contrato não encontrado.',404);return present(row);}
export async function saveContractType(owner:string,input:ContractTypeInput,id?:string){
  const db=getDatabase();const existing=id?await getContractType(owner,id):null;
  const now=new Date().toISOString();const typeId=id||crypto.randomUUID();
  try{
    if(id)await db.prepare('UPDATE contract_types SET name=?,name_key=?,stages_json=?,updated_at=? WHERE id=? AND owner_id=?').bind(input.name,typeNameKey(input.name),JSON.stringify(input.stages),now,id,owner).run();
    else await db.prepare('INSERT INTO contract_types(id,owner_id,name,name_key,stages_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(typeId,owner,input.name,typeNameKey(input.name),JSON.stringify(input.stages),now,now).run();
  }catch(error){if(String(error).includes('UNIQUE'))throw new ContractTypeError('Já existe um tipo de contrato com esse nome.',409);throw error;}
  return {id:typeId,...input,createdAt:existing?.createdAt||now,updatedAt:now};
}
