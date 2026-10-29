import type {ImportEntry,ImportField} from '../types';
import {dateLabel} from '@/shared/utils/presentation';
const counts=new Intl.NumberFormat('pt-BR');
export const MAIN_IMPORT_COLUMNS=['COD_ENTRADA','COD_FAZENDA','COD_TALHAO','AREA','COD_TIPOCOLHEITA','COD_TIPOCARGA','COD_EQUIPAMENTO_TRANSPORTE','COD_EQUIPAMENTO_COMPARTIMENTO','HORACHEGADA','PESOBRUTO','TARA','NR_ORDEM_COLHEITA'];
const labels:Record<string,string>={COD_ENTRADA:'Entrada',COD_FAZENDA:'Fazenda',COD_TALHAO:'Talhão',AREA:'Área (ha)',COD_TIPOCARGA:'Tipo de carga',COD_EQUIPAMENTO_TRANSPORTE:'Equipamento',COD_EQUIPAMENTO_COMPARTIMENTO:'Compartimento',HORACHEGADA:'Chegada',PESOBRUTO:'Peso bruto',TARA:'Tara',NR_ORDEM_COLHEITA:'Ordem de colheita'};
export function importFieldLabel(field:Pick<ImportField,'key'|'label'>){
 if(field.label.replaceAll('_',' ').toUpperCase()!==field.key.replaceAll('_',' ').toUpperCase())return field.label;
 return labels[field.key]??field.label.replaceAll('_',' ').toLowerCase().replace(/^./,letter=>letter.toUpperCase());
}
export function mainImportFields(fields:ImportField[],selectedKey:string){
 const main=MAIN_IMPORT_COLUMNS.flatMap(key=>{const field=fields.find(item=>item.key===key);return field?[field]:[];});const selected=fields.find(field=>field.key===selectedKey);const visible=main.length?main:fields.slice(0,10);
 return selected&&!visible.some(field=>field.key===selectedKey)?[...visible,selected]:visible;
}
export function importCount(value:number|undefined){return value===undefined?'—':counts.format(value);}
export function importValue(field:Pick<ImportField,'type'>,value:string|undefined){
 if(!value)return '—';if(field.type==='date')return dateLabel(value);if(field.type!=='decimal')return value;
 const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(value);if(!match)return value;
 return match[1]+match[2].replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(match[3]!==undefined?','+match[3]:'');
}
/** Decoration only: group identity and order are supplied by the authorized RPC projection. */
export function importGroupDecoration(entry:Pick<ImportEntry,'groupKey'|'groupOrdinal'>,previous?:Pick<ImportEntry,'groupKey'>){
 const key=entry.groupKey;const ordinal=entry.groupOrdinal;
 if(!key||typeof ordinal!=='number'||!Number.isSafeInteger(ordinal)||ordinal<1)return {key:null,ordinal:null,band:'none' as const,start:false};
 return {key,ordinal,band:ordinal%2===0?'alternate' as const:'base' as const,start:key!==previous?.groupKey};
}
