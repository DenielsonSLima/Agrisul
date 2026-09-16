export type LegacyPracticeInput={name:string;description:string};
export const practiceNameKey=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
export function validatePractice(input:unknown):LegacyPracticeInput {
  if(!input||typeof input!=='object')throw new Error('Dados do manejo inválidos.');
  const d=input as Record<string,unknown>;
  if(typeof d.name!=='string'||d.name.trim().length<2||d.name.trim().length>150)throw new Error('Informe um nome entre 2 e 150 caracteres.');
  if(typeof d.description!=='string'||d.description.length>2000)throw new Error('A descrição deve ter até 2.000 caracteres.');
  return {name:d.name.trim(),description:d.description.trim()};
}
