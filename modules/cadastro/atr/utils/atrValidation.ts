import type {AtrInput} from '../types';
export function validateAtr(input:unknown):AtrInput {
  if(!input||typeof input!=='object')throw new Error('Dados de ATR inválidos.');
  const data=input as Record<string,unknown>;
  if(typeof data.year!=='number'||!Number.isInteger(data.year)||data.year<1900||data.year>9999)throw new Error('Informe um ano entre 1900 e 9999.');
  if(typeof data.month!=='number'||!Number.isInteger(data.month)||data.month<1||data.month>12)throw new Error('Selecione o mês de referência.');
  const fields=['monthlyGrossValue','monthlyNetValue','accumulatedGrossValue','accumulatedNetValue'] as const;
  const values={} as Pick<AtrInput,(typeof fields)[number]>;
  for(const field of fields){
    if(typeof data[field]!=='string')throw new Error('Informe as quatro cotações bruta e líquida do ATR.');
    const value=data[field].trim().replace(',','.');
    if(!/^\d{1,9}(\.\d{1,6})?$/.test(value))throw new Error('Informe cotações válidas, com até seis casas decimais.');
    values[field]=value.replace(/^0+(?=\d)/,'');
  }
  // Preserve decimal precision as text instead of rounding with floating point.
  return {year:data.year,month:data.month,...values};
}
