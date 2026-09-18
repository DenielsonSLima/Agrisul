import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {rpcRequest,RpcError} from '@/shared/supabase/rpc';
import {fetchWorkspaceId} from '@/shared/supabase/workspace';
import {defaultWatermark,type WatermarkOrientation,type WatermarkSettings} from '../types';

const bucket='billing-watermarks';
type OrientationFiles=Partial<Record<WatermarkOrientation,File|null>>;
type OrientationFlags=Partial<Record<WatermarkOrientation,boolean>>;

export class WatermarkApiError extends Error {constructor(message:string,public status:number){super(message);}}

function hasOwn(value:object,key:string){return Object.prototype.hasOwnProperty.call(value,key);}
function normalizeSettings(value:Partial<WatermarkSettings>):WatermarkSettings{
 const orientation=value.orientation==='landscape'?'landscape':'portrait';
 const portraitImageKey=hasOwn(value,'portraitImageKey')?value.portraitImageKey??null:orientation==='portrait'?value.imageKey??null:null;
 const landscapeImageKey=hasOwn(value,'landscapeImageKey')?value.landscapeImageKey??null:orientation==='landscape'?value.imageKey??null:null;
 const portraitImageName=hasOwn(value,'portraitImageName')?value.portraitImageName??'':orientation==='portrait'?value.imageName??'':'';
 const landscapeImageName=hasOwn(value,'landscapeImageName')?value.landscapeImageName??'':orientation==='landscape'?value.imageName??'':'';
 return {...defaultWatermark,...value,orientation,portraitImageKey,portraitImageName,portraitImageUrl:null,landscapeImageKey,landscapeImageName,landscapeImageUrl:null};
}
async function withImageUrls(value:Partial<WatermarkSettings>,signal?:AbortSignal):Promise<WatermarkSettings>{
 const settings=normalizeSettings(value);
 const paths=[...new Set([settings.portraitImageKey,settings.landscapeImageKey].filter((key):key is string=>!!key))];
 if(!paths.length)return settings;
 const {data,error}=await getSupabaseBrowserClient().storage.from(bucket).createSignedUrls(paths,3600);
 if(signal?.aborted)throw new DOMException('Consulta cancelada','AbortError');
 if(error)throw new Error('Não foi possível carregar as imagens da marca d’água. Tente novamente.');
 const urls=new Map((data??[]).filter(item=>!item.error&&item.signedUrl).map(item=>[item.path,item.signedUrl]));
 if(paths.some(path=>!urls.get(path)))throw new Error('Não foi possível carregar as imagens da marca d’água. Tente novamente.');
 return {...settings,portraitImageUrl:settings.portraitImageKey?urls.get(settings.portraitImageKey)??null:null,landscapeImageUrl:settings.landscapeImageKey?urls.get(settings.landscapeImageKey)??null:null};
}
export async function fetchWatermark(signal?:AbortSignal){
 const {settings}=await rpcRequest<{settings:Partial<WatermarkSettings>}>('watermarks','get',{},signal);
 if(signal?.aborted)throw new DOMException('Consulta cancelada','AbortError');
 return withImageUrls(settings,signal);
}
export async function persistWatermark(settings:WatermarkSettings,files:OrientationFiles={},removed:OrientationFlags={}){
 const client=getSupabaseBrowserClient();
 const {data:{session},error:authError}=await client.auth.getSession();
 if(authError||!session)throw new WatermarkApiError('Entre na sua conta para salvar a marca d’água.',401);
 const storage=client.storage.from(bucket);
 const previous={portrait:settings.portraitImageKey,landscape:settings.landscapeImageKey};
 const keys:{portrait:string|null;landscape:string|null}={portrait:removed.portrait?null:previous.portrait,landscape:removed.landscape?null:previous.landscape};
 const names={portrait:removed.portrait?'':settings.portraitImageName,landscape:removed.landscape?'':settings.landscapeImageName};
 const uploaded:string[]=[];
 const workspaceId=Object.values(files).some(Boolean)?await fetchWorkspaceId():session.user.id;
 for(const orientation of ['portrait','landscape'] as const){
  const file=files[orientation];if(!file)continue;
  const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'} as Record<string,string>)[file.type];
  if(!extension||!file.size||file.size>3*1024*1024)throw new Error('Envie uma imagem PNG, JPG ou WebP de até 3 MB.');
  const uploadedKey=`${workspaceId}/${orientation}/${crypto.randomUUID()}.${extension}`;
  const {error}=await storage.upload(uploadedKey,file,{contentType:file.type,upsert:false});
  if(error){if(uploaded.length)void storage.remove(uploaded);throw new Error(`Não foi possível enviar a imagem de ${orientation==='portrait'?'retrato':'paisagem'}. Verifique o arquivo e tente novamente.`);}
  uploaded.push(uploadedKey);keys[orientation]=uploadedKey;names[orientation]=file.name;
 }
 let response:{settings:Partial<WatermarkSettings>};
 try{
  response=await rpcRequest<{settings:Partial<WatermarkSettings>}>('watermarks','save',{
   orientation:settings.orientation,opacity:settings.opacity,size:settings.size,
   portraitImageKey:keys.portrait,portraitImageName:names.portrait,
   landscapeImageKey:keys.landscape,landscapeImageName:names.landscape,
  });
 }catch(error){
  if(uploaded.length&&error instanceof RpcError&&error.status<500)void storage.remove(uploaded);
  throw error;
 }
 const obsolete=(['portrait','landscape'] as const).flatMap(orientation=>{
  const old=previous[orientation];return old&&old!==keys[orientation]&&(!!files[orientation]||!!removed[orientation])?[old]:[];
 });
 if(obsolete.length)void storage.remove([...new Set(obsolete)]);
 return withImageUrls(response.settings);
}
