export const cultureNameKey=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
export function validateCultureName(input:unknown){if(typeof input!=='string'||input.trim().length<2||input.trim().length>150)throw new Error('Informe um nome entre 2 e 150 caracteres.');return input.trim();}
export {culturesHref,cultureHref} from './cultureNavigation';
