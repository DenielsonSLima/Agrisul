type ShareTarget=Pick<Navigator,'canShare'|'share'>;

export async function sharePdfFile(file:File,target:ShareTarget=navigator):Promise<'shared'|'unsupported'|'cancelled'>{
 if(typeof target.share!=='function'||typeof target.canShare!=='function'||!target.canShare({files:[file]}))return 'unsupported';
 try{
  // Invoke share before any asynchronous preparation so the click retains user activation.
  await target.share({files:[file],title:file.name.replace(/\.pdf$/i,'')});
  return 'shared';
 }catch(error){
  if(error instanceof Error&&error.name==='AbortError')return 'cancelled';
  throw error;
 }
}
