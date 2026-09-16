import {getDatabase} from "@/db/client";
import type {Company,CompanyInput} from "../types";
const detailColumns={legalName:"legal_name",tradeName:"trade_name",street:"street",number:"number",complement:"complement",district:"district",city:"city",state:"state",zipCode:"zip_code",phone:"phone",email:"email"} as const;
type Row={id:string;name:string;cnpj:string;is_primary:number;created_at:string;updated_at:string}&Record<typeof detailColumns[keyof typeof detailColumns],string>;
const columns="id,name,cnpj,is_primary,created_at,updated_at,"+Object.values(detailColumns).join(",");
const present=(r:Row):Company=>({...Object.fromEntries(Object.entries(detailColumns).map(([k,v])=>[k,r[v]])),id:r.id,name:r.name,legalName:r.legal_name||r.name,cnpj:r.cnpj,isPrimary:!!r.is_primary,createdAt:r.created_at,updatedAt:r.updated_at}) as Company;
export class CompanyError extends Error{constructor(message:string,public status=400){super(message)}}
export async function listCompanies(owner:string){const r=await getDatabase().prepare(`SELECT ${columns} FROM companies WHERE owner_id=? ORDER BY is_primary DESC,name COLLATE NOCASE`).bind(owner).all<Row>();return r.results.map(present)}
export async function saveCompany(owner:string,input:CompanyInput,id?:string){
 const db=getDatabase();const existing=id?await db.prepare("SELECT id,is_primary FROM companies WHERE id=? AND owner_id=?").bind(id,owner).first<{id:string;is_primary:number}>():null;
 if(id&&!existing)throw new CompanyError("Empresa não encontrada.",404);
 const primary=await db.prepare("SELECT id FROM companies WHERE owner_id=? AND is_primary=1").bind(owner).first<{id:string}>();
 const isPrimary=!primary||input.isPrimary;
 if(existing?.is_primary&&!input.isPrimary)throw new CompanyError("Defina outra empresa como principal antes de alterar esta para unidade.");
 const companyId=id||crypto.randomUUID();const now=new Date().toISOString();const name=input.tradeName||input.legalName;
 const values=Object.keys(detailColumns).map(key=>input[key as keyof typeof detailColumns]);
 const statements:D1PreparedStatement[]=[];
 if(isPrimary)statements.push(db.prepare("UPDATE companies SET is_primary=0,updated_at=? WHERE owner_id=? AND is_primary=1").bind(now,owner));
 if(id)statements.push(db.prepare(`UPDATE companies SET name=?,cnpj=?,is_primary=?,${Object.values(detailColumns).map(c=>c+"=?").join(",")},updated_at=? WHERE id=? AND owner_id=?`).bind(name,input.cnpj,isPrimary?1:0,...values,now,id,owner));
 else statements.push(db.prepare(`INSERT INTO companies(id,owner_id,name,cnpj,is_primary,${Object.values(detailColumns).join(",")},created_at,updated_at) VALUES(${Array(18).fill("?").join(",")})`).bind(companyId,owner,name,input.cnpj,isPrimary?1:0,...values,now,now));
 try{await db.batch(statements)}catch(error){if(String(error).includes("UNIQUE"))throw new CompanyError("Já existe uma empresa com esse CNPJ ou o cadastro foi alterado. Atualize a lista e tente novamente.",409);throw error}
 return {id:companyId};
}
