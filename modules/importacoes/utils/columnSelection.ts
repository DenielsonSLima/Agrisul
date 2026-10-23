import type {ImportField} from '../types';
export interface ColumnTypeDraft {key:string;sourceType:ImportField['type'];value:ImportField['type']}
export function resolveColumnType(field:Pick<ImportField,'key'|'type'>|undefined,draft:ColumnTypeDraft|null):ImportField['type']{
 if(draft&&draft.key===field?.key&&draft.sourceType===field?.type)return draft.value;
 return field?.type??'text';
}
