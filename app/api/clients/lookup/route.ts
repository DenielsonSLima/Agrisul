import {getRequestUser} from '@/shared/supabase/server';
import {LookupError,lookupCnpj} from '@/shared/services/cnpjLookup';
import {normalizeCnpj,validCnpj} from '@/shared/utils/cnpj';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
  if(!await getRequestUser(request))return reply({error:'Entre para consultar o CNPJ do parceiro.'},401);
  const cnpj=normalizeCnpj(new URL(request.url).searchParams.get('cnpj')||'');
  if(!validCnpj(cnpj))return reply({error:'Informe um CNPJ válido com 14 caracteres.'},400);
  try{return reply({details:await lookupCnpj(cnpj)});}catch(error){if(error instanceof LookupError)return reply({error:error.message},error.status);return reply({error:'Não foi possível consultar. Tente novamente ou preencha manualmente.'},503);}
}
