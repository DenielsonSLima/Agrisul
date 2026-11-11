import {IMPORT_EQUIPMENT_FIELDS} from './equipmentFields';

export type ImportCellMove='down'|'up'|'next'|'previous';
export type ImportCellNavigationEntry={id:string;groupKey?:string|null};

/** Candidates follow the displayed rows and columns; IDs never imply position. */
export function importCellNavigation(
 entries:readonly ImportCellNavigationEntry[],fields:readonly {key:string}[],entryId:string,fieldKey:string,move:ImportCellMove,
):Array<{entryId:string;fieldKey:string}>{
 const row=entries.findIndex(entry=>entry.id===entryId),column=fields.findIndex(field=>field.key===fieldKey);
 if(row<0||column<0)return [];
 const candidates:Array<{entryId:string;fieldKey:string}>=[];
 if(move==='down'||move==='up'){
  const step=move==='down'?1:-1;
  const group=IMPORT_EQUIPMENT_FIELDS.some(key=>key===fieldKey)?entries[row].groupKey:null;
  for(let index=row+step;index>=0&&index<entries.length;index+=step){
   // Use the RPC identity, including when sorting separates a trip's rows.
   // Missing identities remain individual rows; ERP codes do not define trips.
   if(group&&entries[index].groupKey===group)continue;
   candidates.push({entryId:entries[index].id,fieldKey});
  }
 }else if(move==='next'||move==='previous'){
  const step=move==='next'?1:-1;
  for(let index=row*fields.length+column+step;index>=0&&index<entries.length*fields.length;index+=step){
   candidates.push({entryId:entries[Math.floor(index/fields.length)].id,fieldKey:fields[index%fields.length].key});
  }
 }
 return candidates;
}
