import {TV_CHANNELS,type TvVideo} from './catalog.ts';

export type TvTopic='sugarcane'|'grains'|'agro';
const normalize=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
const SUGARCANE=/\b(?:cana de acucar|acucar|etanol|bioetanol|sucroenergetic[oa]s?|sucroalcooleir[oa]s?|canavia(?:l|is)|canavieir[oa]s?|consecana)\b/;
const GRAINS=/\b(?:soja|milho|sojicult(?:or(?:es)?|ura))\b/;
const AGRO=/\b(?:agro|agronegocio|agricultura|agricolas?|agricultor(?:es|as|a)?|agropecuaria|agropecuario|agroindustria|agroindustrial|pecuaria|pecuaristas?|avicultura|avicultor(?:es)?|suinocultura|suinocultor(?:es)?|bovinocultura|piscicultura|cafeicultura|cafeicultor(?:es)?|citricultura|citricultor(?:es)?|lavouras?|plantio|colheita|safras?|irrigacao|adubacao|fertilizantes?|defensivos agricolas|silagem|ensilagem|pastagens?|rebanhos?|boi gordo|arroba do boi|gado de corte|gado leiteiro|credito rural|seguro rural|produtor(?:es)? rurais?|produtor rural|trabalhador(?:es)? rurais?|agricultura familiar|reforma agraria|regularizacao fundiaria|maquinas agricolas|tratores?|colheitadeiras?|biodiesel|biocombustiveis|bioenergia)\b/;
const AGRICULTURAL_CONTEXT=/\b(?:safras?|plantio|colheita|moagem|usinas?|producao|produtividade|produtor(?:es)?|lavouras?|exportac(?:ao|oes)|importac(?:ao|oes)|cotac(?:ao|oes)|precos?|mercado|cultivo|agricultura|agro|agronegocio|pecuaria|fertilizantes?|credito rural)\b/;
const DESCRIPTION_CONTEXT=/\b(?:safras?|plantio|colheita|moagem|usinas?|producao|produtividade|produtor(?:es)?|agricultor(?:es)?|lavouras?|exportac(?:ao|oes)|importac(?:ao|oes)|cotac(?:ao|oes)|precos?|cultivo|fertilizantes?|credito rural|irrigacao|adubacao|rebanhos?|pastagens?)\b/;
const OTHER_CROPS=/\b(?:cafe|algodao|trigo|arroz|feijao|sorgo|laranja|citros|citrus|cacau|leite|carne|carnes|frango|suinos|bovinos|hortalicas|hortifruti)\b/;
const NOT_AGRO=/\b(?:seguranca publica|pec da seguranca|impeachment|anistia|corrupcao|stf|supremo|eleicoes|eleitoral|eleitorais|politica|politico|politicos|lula|bolsonaro|trump|guerra|gaza|israel|ucrania|futebol|campeonato|novela|filmes?|cinema|musica|celebridades?|religiao|culto|bitcoin|criptomoedas|ibovespa|bolsa de valores|hospitais?|vacinas?|medicamentos?|prisao|preso|policia|homicidio|assassinato|roubo|furto|peculato)\b/;
const FOOD_OR_METAPHOR=/\b(?:receitas?|bolo|bolos|doces|sobremesa|diabetes|glicemia|acucar no sangue|consumo de acucar|safra de filmes|safra do cinema|colheita de talentos)\b/;
const INDUSTRY=/\b(?:lavouras?|agricultura|agro|agronegocio|usinas?|moagem|plantio|exportac(?:ao|oes)|importac(?:ao|oes)|cotac(?:ao|oes)|safra de (?:soja|milho|cana)|producao de (?:soja|milho|cana))\b/;

function topic(text:string):TvTopic|null{
 if(SUGARCANE.test(text)||/\bcana\b/.test(text)&&AGRICULTURAL_CONTEXT.test(text))return 'sugarcane';
 if(GRAINS.test(text))return 'grains';
 if(AGRO.test(text)||OTHER_CROPS.test(text)&&AGRICULTURAL_CONTEXT.test(text))return 'agro';
 return null;
}

function articleDescription(description:string){
 // Publisher descriptions often append a channel biography, social links and
 // lists of covered crops. These advertise the channel, not the individual video.
 const paragraphs=description.slice(0,1200).replace(/<[^>]*>/g,' ').split(/[\r\n]+|(?<=[.!?])\s+/);
 const relevant:string[]=[];
 for(const paragraph of paragraphs){
  const plain=normalize(paragraph);
  if(/\b(?:inscreva|inscrevam|inscrever|inscreva se|siga|sigam|curta|compartilhe|ative|sininho|acompanhe|assista|acesse|fique por dentro|bem vindo|redes sociais|nosso canal|canal oficial|site oficial|seja membro|somos|sua fonte|especializado em|maior canal|referencia (?:do|em) agronegocio|noticias (?:do|sobre o|sobre) (?:agro|agronegocio)|canal rural|canal do boi|noticias agricolas|tv senado|agromais|youtube|instagram|facebook|whatsapp|tiktok|twitter)\b/.test(plain)||/https?:\/\/|#\S+/.test(paragraph))break;
  if(plain)relevant.push(plain);
  if(relevant.join(' ').length>=600)break;
 }
 return relevant.join(' ').slice(0,600);
}

export function classifyTvVideo(title:string,description=''):TvTopic|null{
 const headline=normalize(title);
 if(!headline)return null;
 if(FOOD_OR_METAPHOR.test(headline)&&!INDUSTRY.test(headline))return null;
 const headlineTopic=topic(headline);
 if(headlineTopic==='sugarcane'||headlineTopic==='grains')return headlineTopic;
 // Specific unrelated subjects outrank a publisher's generic description.
 if(!headlineTopic&&NOT_AGRO.test(headline))return null;
 const context=articleDescription(description),contextTopic=topic(context);
 const contextual=context.length>=30&&DESCRIPTION_CONTEXT.test(context)?contextTopic:null;
 return contextual??headlineTopic;
}

type Candidate={video:TvVideo;topic:TvTopic;time:number};
type Choice={sugarcane:number;grains:number;agro:number;freshness:number;videos:TvVideo[]};
const compareVideos=(left:TvVideo,right:TvVideo)=>Date.parse(right.publishedAt)-Date.parse(left.publishedAt)||left.id.localeCompare(right.id);

/** Fill up to four relevant videos per allowed channel, then optimize the mix globally. */
export function curateTvVideos(videos:TvVideo[],channelIds:string[]):TvVideo[]{
 const channels=TV_CHANNELS.filter(channel=>channelIds.includes(channel.id)).map(channel=>channel.id);
 if(!channels.length)return [];
 const allowed=new Set<string>(channels),seen=new Set<string>();
 const groups=new Map<string,Candidate[]>(channels.map(id=>[id,[]]));
 for(const video of [...videos].sort(compareVideos)){
  if(!allowed.has(video.channelId)||seen.has(video.id))continue;
  const time=Date.parse(video.publishedAt);if(!Number.isFinite(time))continue;
  const description=(video as TvVideo&{description?:unknown}).description;
  const category=classifyTvVideo(video.title,typeof description==='string'?description:'');
  if(!category)continue;
  seen.add(video.id);groups.get(video.channelId)!.push({video,topic:category,time});
 }
 let states=new Map<string,Choice>([['0:0',{sugarcane:0,grains:0,agro:0,freshness:0,videos:[]}]]),total=0;
 for(const channel of channels){
  const candidates=groups.get(channel)!,capacity=Math.min(4,candidates.length);
  if(!capacity)continue;
  total+=capacity;
  const sugar=candidates.filter(item=>item.topic==='sugarcane').slice(0,4),grains=candidates.filter(item=>item.topic==='grains').slice(0,4),agro=candidates.filter(item=>item.topic==='agro').slice(0,4);
  const options:Choice[]=[];
  for(let s=0;s<=Math.min(capacity,sugar.length);s++)for(let g=0;g<=Math.min(capacity-s,grains.length);g++){
   const a=capacity-s-g;if(a>agro.length)continue;
   const selected=[...sugar.slice(0,s),...grains.slice(0,g),...agro.slice(0,a)];
   options.push({sugarcane:s,grains:g,agro:a,freshness:selected.reduce((sum,item)=>sum+item.time,0),videos:selected.map(item=>item.video)});
  }
  const next=new Map<string,Choice>();
  for(const previous of states.values())for(const option of options){
   const s=previous.sugarcane+option.sugarcane,g=previous.grains+option.grains,key=`${s}:${g}`,freshness=previous.freshness+option.freshness;
   const current=next.get(key);
   if(!current||freshness>current.freshness)next.set(key,{sugarcane:s,grains:g,agro:previous.agro+option.agro,freshness,videos:[...previous.videos,...option.videos]});
  }
  states=next;
 }
 let best:Choice|undefined,bestError=Infinity;
 for(const choice of states.values()){
  // Integer arithmetic compares exact 50/20/30 targets, including scarce totals
  // that cannot be split into whole videos with those exact percentages.
  const error=(10*choice.sugarcane-5*total)**2+(10*choice.grains-2*total)**2+(10*choice.agro-3*total)**2;
  if(error<bestError||error===bestError&&choice.freshness>(best?.freshness??-Infinity)){best=choice;bestError=error;}
 }
 return best?.videos.sort(compareVideos)??[];
}
