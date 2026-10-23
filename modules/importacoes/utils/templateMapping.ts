import type {ImportField} from '../types';
import type {WorkbookTemplateInspection} from './documentIO';

export interface TemplateTypeReview {
 key:string; label:string; column:string; previousType:ImportField['type']; inferredType:ImportField['type']|null;
 mixed:boolean; reason:string; requiresChoice:boolean; observedTypes:ImportField['type'][]; formats:string[];
}
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase();

/** Match the template's headers while retaining PDF sources, manual defaults and explicit conversions. */
export function mergeTemplateFields(current:ImportField[],inspection:WorkbookTemplateInspection){
 const fields=current.map(field=>({...field}));const used=new Set<number>();const reviews:TemplateTypeReview[]=[];
 for(const incoming of inspection.fields){
  const names=new Set([normalized(incoming.key),normalized(incoming.label)]);
  let matches=fields.map((field,index)=>({field,index})).filter(({field,index})=>!used.has(index)&&(names.has(normalized(field.key))||names.has(normalized(field.label))));
  let columnOnly=false;
  if(!matches.length){matches=fields.map((field,index)=>({field,index})).filter(({field,index})=>!used.has(index)&&field.column===incoming.column&&!inspection.fields.some(other=>other!==incoming&&[normalized(other.key),normalized(other.label)].some(name=>name===normalized(field.key)||name===normalized(field.label))));columnOnly=matches.length>0;}
  if(matches.length>1)throw new Error(`O cabeçalho “${incoming.label}” corresponde a mais de um campo. Revise as chaves e colunas do perfil antes de carregar o modelo.`);
  const evidence=inspection.columnTypes.find(column=>column.column===incoming.column);
  const existing=matches[0];const previousType=existing?.field.type??incoming.type;
  const next:ImportField=existing?{...existing.field,column:incoming.column}:{...incoming};
  // A structural default of "text" is not evidence for a blank Excel column.
  if(evidence?.inferredType&&!evidence.mixed)next.type=evidence.inferredType;
  else if(existing)next.type=existing.field.type;
  if(existing){fields[existing.index]=next;used.add(existing.index);}else{used.add(fields.length);fields.push(next);}
  const reason=[columnOnly?`O cabeçalho do Excel é “${incoming.label}”; o vínculo foi localizado pela coluna.`:'',evidence?.reason??'A coluna não possui dados suficientes para identificar o tipo.'].filter(Boolean).join(' ');
  reviews.push({key:next.key,label:next.label,column:next.column,previousType,inferredType:evidence?.inferredType??null,mixed:evidence?.mixed??false,reason,requiresChoice:!!evidence?.mixed||columnOnly||(!existing&&!evidence?.inferredType),observedTypes:evidence?.observedTypes??[],formats:evidence?.formats??[]});
 }
 return {fields,reviews};
}
