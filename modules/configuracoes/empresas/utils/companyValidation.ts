import type {CompanyInput} from "../types";
import {normalizeCnpj,validCnpj} from "@/shared/utils/cnpj";
export {normalizeCnpj,validCnpj,formatCnpj} from "@/shared/utils/cnpj";
export function validateCompany(input:unknown):CompanyInput{
 if(!input||typeof input!=="object")throw new Error("Dados de empresa inválidos.");
 const d=input as Record<string,unknown>;
 const limits={cnpj:18,legalName:200,tradeName:200,street:200,number:30,complement:150,district:100,city:100,state:2,zipCode:9,phone:40,email:150};
 const result:Record<string,string>={};
 for(const [key,max] of Object.entries(limits)){if(typeof d[key]!=="string"||(d[key] as string).length>max)throw new Error("Verifique os campos da empresa.");result[key]=(d[key] as string).trim()}
 if(result.legalName.length<2)throw new Error("Informe a razão social da empresa.");
 result.cnpj=normalizeCnpj(result.cnpj);if(result.cnpj&&!validCnpj(result.cnpj))throw new Error("Informe um CNPJ válido com 14 caracteres.");
 result.state=result.state.toUpperCase();if(result.state&&!/^[A-Z]{2}$/.test(result.state))throw new Error("Informe a UF com duas letras.");
 if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw new Error("Informe um e-mail válido.");
 if(typeof d.isPrimary!=="boolean")throw new Error("Escolha o tipo da empresa.");
 return {...result,isPrimary:d.isPrimary} as CompanyInput;
}
