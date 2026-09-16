import {hectaresToUnits,unitsToHectares} from '@/shared/utils/hectares';
import type {PlotInput} from '../types';
export function validatePlot(input:unknown):PlotInput {
  if(!input||typeof input!=='object')throw new Error('Dados do talhão inválidos.');
  const d=input as Record<string,unknown>;
  if(typeof d.name!=='string'||typeof d.areaHa!=='string')throw new Error('Preencha nome e área do talhão.');
  const name=d.name.trim();if(name.length<2||name.length>150)throw new Error('Informe um nome entre 2 e 150 caracteres.');
  const units=hectaresToUnits(d.areaHa);if(units<=0)throw new Error('A área do talhão deve ser maior que zero.');
  return {name,areaHa:unitsToHectares(units)};
}
