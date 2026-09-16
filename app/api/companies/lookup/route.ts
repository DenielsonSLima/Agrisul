import {getRequestUser} from "@/shared/supabase/server";
import {LookupError,lookupCnpj} from "@/modules/configuracoes/empresas/services/cnpjLookup";
import {normalizeCnpj,validCnpj} from "@/modules/configuracoes/empresas/utils/companyValidation";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request:Request){
 if(!await getRequestUser(request))return reply({error:"Entre para consultar e cadastrar suas empresas."},401);
 const cnpj=normalizeCnpj(new URL(request.url).searchParams.get("cnpj")||"");
 if(!validCnpj(cnpj))return reply({error:"Informe um CNPJ válido com 14 caracteres."},400);
 try{return reply({company:await lookupCnpj(cnpj)})}catch(error){if(error instanceof LookupError)return reply({error:error.message},error.status);return reply({error:"Não foi possível consultar. Tente novamente ou preencha manualmente."},503)}
}
