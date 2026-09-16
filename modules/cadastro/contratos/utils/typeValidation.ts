import type {ContractTypeInput} from '../types';
export const typeNameKey=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
export function validateContractType(input:unknown):ContractTypeInput {
  if(!input||typeof input!=='object')throw new Error('Dados do tipo de contrato inválidos.');
  const data=input as Record<string,unknown>;
  if(typeof data.name!=='string'||data.name.trim().length<2||data.name.trim().length>150)throw new Error('Informe um nome entre 2 e 150 caracteres.');
  if(!Array.isArray(data.stages)||data.stages.length>50)throw new Error('Cadastre até 50 etapas por tipo.');
  const ids=new Set<string>();
  const stages=data.stages.map((stage:unknown)=>{
    if(!stage||typeof stage!=='object')throw new Error('Etapa inválida.');
    const item=stage as Record<string,unknown>;
    if(typeof item.id!=='string'||!item.id||item.id.length>100||ids.has(item.id))throw new Error('Identificador de etapa inválido.');
    if(typeof item.name!=='string'||!item.name.trim()||item.name.trim().length>120)throw new Error('Preencha o nome de cada etapa, com até 120 caracteres.');
    ids.add(item.id);return {id:item.id,name:item.name.trim()};
  });
  return {name:data.name.trim(),stages};
}
export {contractTypesHref,contractTypeHref} from './typeNavigation';
