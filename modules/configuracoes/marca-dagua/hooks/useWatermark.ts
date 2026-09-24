import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useCadastroMutation} from '@/modules/cadastro/hooks/useCadastroQuery';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {billingKeys} from '@/shared/query/keys';
import {notifications} from '@/shared/feedback';
import {defaultWatermark,type WatermarkOrientation,type WatermarkSettings} from '../types';
import {fetchWatermark,persistWatermark} from '../services/watermarkApi';
import {MAX_IMAGE_BYTES} from '../utils/validation';

type OrientationFiles=Partial<Record<WatermarkOrientation,File|null>>;
type OrientationFlags=Record<WatermarkOrientation,boolean>;

const emptyFlags=():OrientationFlags=>({portrait:false,landscape:false});

export function useWatermark(){
 const {user,ready}=useAuth();const userId=user?.id??'anonymous';
 const query=useQuery({queryKey:billingKeys.resource(userId,'watermarks'),queryFn:({signal})=>fetchWatermark(signal),enabled:ready&&!!user,staleTime:300000,refetchInterval:3000000});
 const [draft,setDraft]=useState<WatermarkSettings|null>(null);
 const [files,setFiles]=useState<OrientationFiles>({});
 const [removed,setRemoved]=useState<OrientationFlags>(emptyFlags);
 const [processingOrientation,setProcessingOrientation]=useState<WatermarkOrientation|null>(null);
 const [error,setError]=useState('');const [saved,setSaved]=useState(false);
 const localUrls=useRef<Record<WatermarkOrientation,string|null>>({portrait:null,landscape:null});
 const selections=useRef<Record<WatermarkOrientation,number>>({portrait:0,landscape:0});
 const settings=draft??query.data??defaultWatermark;
 const loading=!ready||!!user&&query.isPending;
 const release=(orientation:WatermarkOrientation)=>{const url=localUrls.current[orientation];if(url)URL.revokeObjectURL(url);localUrls.current[orientation]=null;};
 useEffect(()=>()=>{for(const orientation of ['portrait','landscape'] as const){selections.current[orientation]++;release(orientation);}},[]);
 const mutation=useCadastroMutation('watermarks',({value,nextFiles,remove,actorId}:{value:WatermarkSettings;nextFiles:OrientationFiles;remove:OrientationFlags;actorId:string})=>persistWatermark(value,nextFiles,remove,actorId),['watermark','report-headers']);
 const change=(patch:Partial<WatermarkSettings>)=>{setDraft(current=>({...current??query.data??defaultWatermark,...patch}));setSaved(false);};
 const choose=async(next:File)=>{
  const orientation=settings.orientation;
  setError('');setSaved(false);
  if(!['image/png','image/jpeg','image/webp'].includes(next.type)||!next.size||next.size>MAX_IMAGE_BYTES){setError('Envie uma imagem PNG, JPG ou WebP de até 3 MB.');return;}
  const token=++selections.current[orientation];const url=URL.createObjectURL(next);setProcessingOrientation(orientation);
  try {
   const image=new Image();image.src=url;await image.decode();
   if(token!==selections.current[orientation]){URL.revokeObjectURL(url);return;}
   if(image.naturalWidth*image.naturalHeight>25000000)throw new Error('A imagem é muito grande. Use uma versão com até 25 megapixels.');
   release(orientation);localUrls.current[orientation]=url;
   setFiles(current=>({...current,[orientation]:next}));
   setRemoved(current=>({...current,[orientation]:false}));
   change(orientation==='portrait'?{portraitImageUrl:url,portraitImageName:next.name}:{landscapeImageUrl:url,landscapeImageName:next.name});
  }catch(caught){URL.revokeObjectURL(url);if(token===selections.current[orientation])setError(caught instanceof Error&&caught.message.includes('megapixels')?caught.message:'Não foi possível abrir essa imagem. Escolha outro arquivo.');}
  finally{if(token===selections.current[orientation])setProcessingOrientation(null);}
 };
 const remove=()=>{
  const orientation=settings.orientation;
  selections.current[orientation]++;release(orientation);
  setFiles(current=>({...current,[orientation]:null}));
  setRemoved(current=>({...current,[orientation]:true}));
  setProcessingOrientation(current=>current===orientation?null:current);
  change(orientation==='portrait'?{portraitImageUrl:null,portraitImageName:''}:{landscapeImageUrl:null,landscapeImageName:''});
 };
 const save=async()=>{
  if(mutation.isPending||loading||processingOrientation!==null||!user)return;setError('');setSaved(false);
  try {
   await mutation.mutateAsync({value:settings,nextFiles:files,remove:removed,actorId:user.id});
   release('portrait');release('landscape');setFiles({});setRemoved(emptyFlags());setDraft(null);setSaved(true);
   notifications.saved('As imagens de retrato e paisagem e os ajustes da marca d’água foram salvos.');
  }catch(caught){const message=(caught as Error).message;setError(message);notifications.error(message);}
 };
 return {settings,loading,saving:mutation.isPending,processing:processingOrientation!==null,loadError:query.error?.message??'',error,authRequired:ready&&!user,dirty:!!draft||!!files.portrait||!!files.landscape||removed.portrait||removed.landscape,saved,change,choose,remove,save,reload:()=>query.refetch()};
}
