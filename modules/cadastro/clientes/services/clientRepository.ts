import {getDatabase} from '@/db/client';
import type {Client,ClientInput} from '../types';
const fields={legalName:'legal_name',tradeName:'trade_name',cnpj:'cnpj',street:'street',number:'number',complement:'complement',district:'district',city:'city',state:'state',zipCode:'zip_code',phone:'phone',email:'email'} as const;
const columns='id,created_at,updated_at,'+Object.values(fields).join(',');
type Row={id:string;created_at:string;updated_at:string}&Record<typeof fields[keyof typeof fields],string>;
const present=(r:Row):Client=>({...Object.fromEntries(Object.entries(fields).map(([key,column])=>[key,r[column]])),id:r.id,createdAt:r.created_at,updatedAt:r.updated_at}) as Client;
export class ClientError extends Error {constructor(message:string,public status:number){super(message);}}
export async function listClients(owner:string){const rows=await getDatabase().prepare(`SELECT ${columns} FROM clients WHERE owner_id=? ORDER BY legal_name COLLATE NOCASE`).bind(owner).all<Row>();return rows.results.map(present);}
export async function getClient(owner:string,id:string){const row=await getDatabase().prepare(`SELECT ${columns} FROM clients WHERE owner_id=? AND id=?`).bind(owner,id).first<Row>();if(!row)throw new ClientError('Cliente não encontrado.',404);return present(row);}
export async function saveClient(owner:string,input:ClientInput,id?:string){
  const db=getDatabase();if(id)await getClient(owner,id);
  const values=Object.keys(fields).map(key=>input[key as keyof ClientInput]);const now=new Date().toISOString();const clientId=id||crypto.randomUUID();
  try {
    if(id)await db.prepare(`UPDATE clients SET ${Object.values(fields).map(column=>column+'=?').join(',')},updated_at=? WHERE id=? AND owner_id=?`).bind(...values,now,id,owner).run();
    else await db.prepare(`INSERT INTO clients(id,owner_id,${Object.values(fields).join(',')},created_at,updated_at) VALUES(${Array(values.length+4).fill('?').join(',')})`).bind(clientId,owner,...values,now,now).run();
  } catch(error){if(String(error).includes('UNIQUE'))throw new ClientError('Já existe um cliente com esse CNPJ.',409);throw error;}
  return getClient(owner,clientId);
}
