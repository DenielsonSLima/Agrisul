export const TV_CHANNELS = [
 {id:'canal-rural',name:'Canal Rural',channelId:'UCcmbSgSpK0dQhw3IBaBGo-g',handle:'canalruralbr',description:'Notícias, mercado e clima no campo'},
 {id:'noticias-agricolas',name:'Notícias Agrícolas',channelId:'UCyHK5OwqtBksa0ItQRG1uVA',handle:'noticiasagricolasoficial',description:'Entrevistas e análises do agronegócio'},
 {id:'tv-senado',name:'TV Senado',channelId:'UCLgti7NuK0RuW9wty-fxPjQ',handle:'tvsenado',description:'Notícias, economia e debates do Senado'},
 {id:'agromais',name:'AgroMais',channelId:'UCgxHcOl2hA1It6QOfOLyJLA',handle:'AgromaisTV',description:'Informação e negócios do agro'},
 {id:'canal-do-boi',name:'Canal do Boi',channelId:'UCumKvcgpO2MCQ45pi-fXf_g',handle:'CanaldoBoiSBA',description:'Agricultura, pecuária e notícias do setor'},
] as const;
export type TvChannel = typeof TV_CHANNELS[number];
export type TvSettings={mode:'autoplay'|'preview'|'skip';channelIds:string[]};
export type TvVideo={id:string;title:string;description?:string;channelId:string;channelName:string;publishedAt:string;thumbnailUrl:string;url:string};
export type TvSource={id:string;name:string;status:'current'|'cached'|'unavailable';updatedAt:string|null};
export type TvFeed={videos:TvVideo[];sources:TvSource[];checkedAt:string;refreshSeconds:number};
export const DEFAULT_TV_SETTINGS:TvSettings={mode:'preview',channelIds:TV_CHANNELS.map(channel=>channel.id)};

export function isTvFeed(value:unknown):value is TvFeed{
 if(!value||typeof value!=='object')return false;
 const feed=value as Partial<TvFeed>;
 return feed.refreshSeconds===300&&typeof feed.checkedAt==='string'&&Number.isFinite(Date.parse(feed.checkedAt))
  &&Array.isArray(feed.sources)&&feed.sources.length===TV_CHANNELS.length&&feed.sources.every(source=>source&&TV_CHANNELS.some(channel=>channel.id===source.id)&&['current','cached','unavailable'].includes(source.status))
  &&Array.isArray(feed.videos)&&feed.videos.length<=20&&feed.videos.every(video=>{
   const channel=TV_CHANNELS.find(channel=>channel.id===video?.channelId);
   return !!channel&&typeof video.id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(video.id)&&typeof video.title==='string'&&video.title.length<=240&&(video.description===undefined||typeof video.description==='string'&&video.description.length<=1200)
    &&video.channelName===channel.name&&video.url===`https://www.youtube.com/watch?v=${video.id}`
    &&video.thumbnailUrl===`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`&&Number.isFinite(Date.parse(video.publishedAt));
  })&&TV_CHANNELS.every(channel=>feed.videos!.filter(video=>video.channelId===channel.id).length<=4)&&new Set(feed.videos.map(video=>video.id)).size===feed.videos.length;
}
