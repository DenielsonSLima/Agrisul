export type AgroNewsArticle={
 id:string;title:string;description:string;url:string;imageUrl:string|null;
 publishedAt:string;sourceId:string;sourceName:string;topic:'cane'|'agro';category:string;
};
export type AgroNewsSource={id:string;name:string;url:string;status:'current'|'cached'|'unavailable';updatedAt:string|null};
export type AgroNewsFeed={articles:AgroNewsArticle[];sources:AgroNewsSource[];checkedAt:string;refreshSeconds:number};

export function isAgroNewsFeed(value:unknown):value is AgroNewsFeed{
 if(!value||typeof value!=='object')return false;
 const feed=value as Partial<AgroNewsFeed>;
 return typeof feed.checkedAt==='string'&&Number.isFinite(Date.parse(feed.checkedAt))&&feed.refreshSeconds===300
  &&Array.isArray(feed.sources)&&feed.sources.length<=6&&feed.sources.every(source=>source&&typeof source.name==='string'&&['current','cached','unavailable'].includes(source.status))
  &&Array.isArray(feed.articles)&&feed.articles.length<=24&&feed.articles.every(article=>article&&typeof article.id==='string'&&typeof article.title==='string'
   &&typeof article.description==='string'&&typeof article.url==='string'&&article.url.startsWith('https://')
   &&(article.imageUrl===null||typeof article.imageUrl==='string'&&article.imageUrl.startsWith('https://'))
   &&typeof article.sourceName==='string'&&typeof article.sourceId==='string'&&typeof article.category==='string'
   &&['cane','agro'].includes(article.topic)&&Number.isFinite(Date.parse(article.publishedAt)));
}
