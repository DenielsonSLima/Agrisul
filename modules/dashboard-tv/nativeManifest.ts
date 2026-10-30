/** Blob MPDs have no HTTP base URI. Resolve the server's stream paths before loading. */
export function nativeManifest(manifest:string,origin:string,videoId:string){
 const base=new URL(origin);
 if(!['http:','https:'].includes(base.protocol)||manifest.length>500000||!manifest.includes('<MPD'))throw new Error('Manifesto de vídeo inválido.');
 let count=0;
 const result=manifest.replace(/<BaseURL>([^<]+)<\/BaseURL>/g,(_match:string,raw:string)=>{
  const target=new URL(raw.trim().replaceAll('&amp;','&'),base.origin);
  if(target.origin!==base.origin||target.pathname!=='/api/dashboard-tv/stream'||target.searchParams.get('videoId')!==videoId||!/^\d+$/.test(target.searchParams.get('itag')??'')||target.username||target.password||target.hash||[...target.searchParams.keys()].some(key=>key!=='videoId'&&key!=='itag'))throw new Error('O vídeo contém um endereço de mídia inválido.');
  count++;
  return `<BaseURL>${target.toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</BaseURL>`;
 });
 if(!count)throw new Error('O vídeo não contém formatos reproduzíveis.');
 return result;
}
