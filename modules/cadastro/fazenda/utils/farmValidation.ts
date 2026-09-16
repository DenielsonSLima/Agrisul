import type {FarmInput} from '../types';
import {brazilStates} from './farmFields';
export {brazilStates} from './farmFields';
export function validateFarm(input:unknown):FarmInput {
  if(!input||typeof input!=='object')throw new Error('Dados da fazenda inválidos.');
  const data=input as Record<string,unknown>;
  for(const key of ['name','areaHa','city','state'])if(typeof data[key]!=='string')throw new Error('Preencha os dados da fazenda.');
  const name=(data.name as string).trim();const city=(data.city as string).trim();const state=(data.state as string).trim().toUpperCase();
  const areaHa=(data.areaHa as string).trim().replace(',','.').replace(/^0+(?=\d)/,'');
  if(name.length<2||name.length>150)throw new Error('Informe um nome entre 2 e 150 caracteres.');
  if(city.length<2||city.length>100)throw new Error('Informe a cidade da fazenda.');
  if(!brazilStates.includes(state))throw new Error('Selecione uma UF válida.');
  if(!/^\d{1,9}(\.\d{1,6})?$/.test(areaHa)||Number(areaHa)<=0)throw new Error('Informe uma área maior que zero, com até seis casas decimais.');
  return {name,areaHa,city,state};
}
