export type ImportCellMove='down'|'up'|'next'|'previous';

/** Candidates follow the displayed rows and columns; IDs never imply position. */
export function importCellNavigation(
 entries:readonly {id:string}[],fields:readonly {key:string}[],entryId:string,fieldKey:string,move:ImportCellMove,
):Array<{entryId:string;fieldKey:string}>{
 const row=entries.findIndex(entry=>entry.id===entryId),column=fields.findIndex(field=>field.key===fieldKey);
 if(row<0||column<0)return [];
 const candidates:Array<{entryId:string;fieldKey:string}>=[];
 if(move==='down'||move==='up'){
  const step=move==='down'?1:-1;
  for(let index=row+step;index>=0&&index<entries.length;index+=step)candidates.push({entryId:entries[index].id,fieldKey});
 }else if(move==='next'||move==='previous'){
  const step=move==='next'?1:-1;
  for(let index=row*fields.length+column+step;index>=0&&index<entries.length*fields.length;index+=step){
   candidates.push({entryId:entries[Math.floor(index/fields.length)].id,fieldKey:fields[index%fields.length].key});
  }
 }
 return candidates;
}
