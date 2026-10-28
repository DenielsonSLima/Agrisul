import type {ImportField} from '../types';
export interface ColumnTypeDraft {key:string;sourceType:ImportField['type'];value:ImportField['type']}
export function visibleImportSelection(entries:readonly {id:string}[],selected:readonly string[]):string[]{
 const ids=new Set(selected);return [...new Set(entries.filter(entry=>ids.has(entry.id)).map(entry=>entry.id))];
}
export function toggleVisibleImportSelection(selected:readonly string[],entries:readonly {id:string}[],checked:boolean):string[]{
 const visible=new Set(entries.map(entry=>entry.id));return checked?[...new Set([...selected,...visible])]:[...new Set(selected.filter(id=>!visible.has(id)))];
}
export function resolveColumnType(field:Pick<ImportField,'key'|'type'>|undefined,draft:ColumnTypeDraft|null):ImportField['type']{
 if(draft&&draft.key===field?.key&&draft.sourceType===field?.type)return draft.value;
 return field?.type??'text';
}
