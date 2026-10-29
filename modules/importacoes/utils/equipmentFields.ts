import type {ImportField} from '../types';
export const IMPORT_EQUIPMENT_FIELDS=['COD_EQUIPAMENTO_TRANSPORTE','COD_EQUIPAMENTO_COMPARTIMENTO'] as const;
/** The server enforces the link; this only previews the affected inputs. */
export function importValueFields(fields:readonly Pick<ImportField,'key'>[],selected:readonly string[]):string[]{
 const keys=[...new Set(selected)];
 if(IMPORT_EQUIPMENT_FIELDS.every(key=>fields.some(field=>field.key===key))&&IMPORT_EQUIPMENT_FIELDS.some(key=>keys.includes(key))){
  for(const key of IMPORT_EQUIPMENT_FIELDS)if(!keys.includes(key))keys.push(key);
 }
 return keys;
}
