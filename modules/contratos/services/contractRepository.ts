import {getDatabase} from '@/db/client';
import type {BillingContract,ContractInput,ContractStatus} from '../types';
type Row={id:string;title:string;client_id:string;client_name:string;client_cnpj:string;type_id:string;type_name:string;stages_json:string;status:ContractStatus;start_date:string;end_date:string;value:string;notes:string;created_at:string;updated_at:string};
const select=`SELECT c.*,p.legal_name AS client_name,p.cnpj AS client_cnpj FROM billing_contracts c JOIN clients p ON p.id=c.client_id AND p.owner_id=c.owner_id WHERE c.owner_id=?`;
const present=(r:Row):BillingContract=>({id:r.id,title:r.title,contractNumber:'',companyId:'',companyName:'',companyCnpj:'',clientId:r.client_id,clientName:r.client_name,clientCnpj:r.client_cnpj,typeId:r.type_id,typeName:r.type_name,stages:JSON.parse(r.stages_json),status:r.status,startDate:r.start_date,endDate:r.end_date,contractedVolume:'0',atrPriceType:'gross',atrPeriodType:'monthly',loadedVolume:'0',remainingVolume:'0',averageAtr:'',billingAmount:'0',billingPending:false,value:r.value,notes:r.notes,createdAt:r.created_at,updatedAt:r.updated_at});
export class ContractError extends Error{constructor(message:string,public status:number){super(message);}}
export async function listContracts(owner:string){const rows=await getDatabase().prepare(select+' ORDER BY c.created_at DESC,c.id').bind(owner).all<Row>();return rows.results.map(present);}
export async function getContract(owner:string,id:string){const row=await getDatabase().prepare(select+' AND c.id=?').bind(owner,id).first<Row>();if(!row)throw new ContractError('Contrato não encontrado.',404);return present(row);}
export async function saveContract(owner:string,input:ContractInput,id?:string){
 const db=getDatabase();if(id)await getContract(owner,id);
 const client=await db.prepare('SELECT id FROM clients WHERE id=? AND owner_id=?').bind(input.clientId,owner).first();if(!client)throw new ContractError('Selecione um cliente cadastrado em Cadastros → Clientes.',400);
 const type=await db.prepare('SELECT name,stages_json FROM contract_types WHERE id=? AND owner_id=?').bind(input.typeId,owner).first<{name:string;stages_json:string}>();if(!type)throw new ContractError('Selecione um tipo de contrato válido.',400);
 const contractId=id||crypto.randomUUID(),now=new Date().toISOString();
 if(id){const result=await db.prepare(`UPDATE billing_contracts SET title=?,client_id=?,type_name=CASE WHEN type_id=? THEN type_name ELSE ? END,stages_json=CASE WHEN type_id=? THEN stages_json ELSE ? END,type_id=?,status=?,start_date=?,end_date=?,value=?,notes=?,updated_at=? WHERE id=? AND owner_id=?`).bind(input.title,input.clientId,input.typeId,type.name,input.typeId,type.stages_json,input.typeId,input.status,input.startDate,input.endDate,input.value,input.notes,now,id,owner).run();if(!result.meta.changes)throw new ContractError('Contrato não encontrado.',404);}
 else await db.prepare(`INSERT INTO billing_contracts(id,owner_id,title,client_id,type_id,type_name,stages_json,status,start_date,end_date,value,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(contractId,owner,input.title,input.clientId,input.typeId,type.name,type.stages_json,input.status,input.startDate,input.endDate,input.value,input.notes,now,now).run();
 return getContract(owner,contractId);
}
