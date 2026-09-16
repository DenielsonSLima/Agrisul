import {normalizeCnpj,validCnpj} from '@/shared/utils/cnpj';
import type {ClientInput} from '../types';
import {clientLimits} from './clientFields';
export {clientLimits} from './clientFields';
export function validateClient(input:unknown):ClientInput {
  if(!input||typeof input!=='object')throw new Error('Dados do parceiro inválidos.');
  const data=input as Record<string,unknown>;const result={} as ClientInput;
  for(const key of Object.keys(clientLimits) as (keyof ClientInput)[]){
    if(typeof data[key]!=='string'||data[key].length>clientLimits[key])throw new Error('Verifique os campos do parceiro.');
    result[key]=data[key].trim();
  }
  if(result.legalName.length<2)throw new Error('Informe a razão social.');
  result.cnpj=normalizeCnpj(result.cnpj);
  if(!validCnpj(result.cnpj))throw new Error('Informe um CNPJ válido com 14 caracteres.');
  result.state=result.state.toUpperCase();
  if(result.state&&!/^[A-Z]{2}$/.test(result.state))throw new Error('Informe a UF com duas letras.');
  if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw new Error('Informe um e-mail válido.');
  return result;
}
