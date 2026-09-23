export const MATERIAL_SOURCE_MAX_BYTES=12*1024*1024;
export const MATERIAL_OUTPUT_MAX_BYTES=3*1024*1024;
const TARGET_BYTES=1500*1024;
const MAX_EDGE=1600;
const MAX_PIXELS=40_000_000;
const ACCEPTED_TYPES=new Set(['image/png','image/jpeg','image/webp']);

function canvasBlob(canvas:HTMLCanvasElement,quality:number){
 return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Não foi possível otimizar a foto.')),'image/webp',quality));
}

function outputName(name:string){
 const base=name.replace(/\.[^.]+$/,'').trim().replace(/[^a-zA-Z0-9À-ÿ._-]+/g,'-').slice(0,120)||'material';
 return `${base}.webp`;
}

export async function optimizeMaterialImage(source:File){
 if(!ACCEPTED_TYPES.has(source.type)||!source.size||source.size>MATERIAL_SOURCE_MAX_BYTES){
  throw new Error('Selecione uma foto PNG, JPG ou WebP de até 12 MB.');
 }
 const url=URL.createObjectURL(source);const image=new Image();
 try{
  image.decoding='async';image.src=url;await image.decode();
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>MAX_PIXELS){
   throw new Error('A foto é muito grande. Use uma imagem com até 40 megapixels.');
  }
  const scale=Math.min(1,MAX_EDGE/Math.max(image.naturalWidth,image.naturalHeight));
  const width=Math.max(1,Math.round(image.naturalWidth*scale));
  const height=Math.max(1,Math.round(image.naturalHeight*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{alpha:true});
  if(!context)throw new Error('Seu navegador não conseguiu processar a foto.');
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(image,0,0,width,height);
  let result:Blob|undefined;
  for(const quality of [.84,.74,.64,.54]){
   result=await canvasBlob(canvas,quality);
   if(result.size<=TARGET_BYTES)break;
  }
  if(!result||result.size>MATERIAL_OUTPUT_MAX_BYTES)throw new Error('Não foi possível reduzir a foto para menos de 3 MB. Escolha outra imagem.');
  return new File([result],outputName(source.name),{type:'image/webp',lastModified:Date.now()});
 }catch(error){
  if(error instanceof Error)throw error;
  throw new Error('Não foi possível abrir essa foto. Escolha outro arquivo.');
 }finally{URL.revokeObjectURL(url);}
}

export function formatImageSize(bytes:number){
 return bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1).replace('.',',')} MB`:`${Math.max(1,Math.round(bytes/1024))} KB`;
}
