import test from 'node:test';
import assert from 'node:assert/strict';
import {TV_CHANNELS} from './catalog.ts';
import {classifyTvVideo,curateTvVideos} from './curation.ts';

const channels=TV_CHANNELS.map(channel=>channel.id),now=Date.parse('2026-10-30T13:00:00Z');
let sequence=0;
function video(channelId,category,age=0,extra={}){
 const channel=TV_CHANNELS.find(item=>item.id===channelId),id=String(++sequence).padStart(11,'0');
 const title=category==='sugarcane'?'Moagem de cana-de-açúcar avança na safra':category==='grains'?'Produtores acompanham preços da soja e do milho':category==='agro'?'Crédito rural amplia investimento na agricultura':'Senado debate PEC da Segurança';
 return {id,channelId,channelName:channel?.name??'Fonte não autorizada',title,publishedAt:new Date(now-age).toISOString(),url:`https://www.youtube.com/watch?v=${id}`,thumbnailUrl:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,...extra};
}
const counts=videos=>videos.reduce((result,item)=>{result[classifyTvVideo(item.title,item.description)]++;return result;},{sugarcane:0,grains:0,agro:0});

test('specific crop terminology wins over broad agro subjects without matching unrelated substrings',()=>{
 for(const title of ['Cana-de-açúcar tem moagem maior','Preço do açúcar sobe na exportação','Etanol de milho ganha novas usinas','Setor sucroenergético divulga resultados','Consecana apresenta projeção','Canaviais recebem tecnologia','Safra de cana avança'])assert.equal(classifyTvVideo(title),'sugarcane',title);
 for(const title of ['Soja: produtor acompanha o mercado','Milho fecha a semana em alta','Sojicultores discutem produtividade'])assert.equal(classifyTvVideo(title),'grains',title);
 for(const title of ['Agricultura familiar recebe crédito','Pecuária amplia exportações','Preço do café preocupa produtores','Chuva atrasa plantio e colheita','Boi gordo: cotação da arroba','Biodiesel e biocombustíveis em debate'])assert.equal(classifyTvVideo(title),'agro',title);
 for(const title of ['Mercado no Brasil','Dólar, juros e economia','PEC da Segurança','Milhões de brasileiros acompanham votação','Copa: emoções dentro de campo','Político vai em cana','Receita de bolo de milho','Como reduzir açúcar no sangue','Nova safra de filmes brasileiros'])assert.equal(classifyTvVideo(title),null,title);
});

test('descriptions contextualize generic titles but channel marketing never turns politics into agro',()=>{
 assert.equal(classifyTvVideo('Entenda o cenário','A produção de cana-de-açúcar recuou nesta safra e produtores discutem a moagem.'),'sugarcane');
 assert.equal(classifyTvVideo('Preços sobem nesta sexta','As cotações de soja e milho subiram após a redução da oferta para os produtores.'),'grains');
 assert.equal(classifyTvVideo('Conheça as mudanças','O crédito rural para agricultores foi ampliado para financiar equipamentos de irrigação.'),'agro');
 assert.equal(classifyTvVideo('Mercado de soja em alta','A safra de cana-de-açúcar também é abordada neste programa.'),'grains','A specific headline outranks the description');
 assert.equal(classifyTvVideo('Crédito rural ganha apoio','A safra de cana-de-açúcar motivou novas linhas de financiamento para produtores.'),'sugarcane');
 const descriptions=[
  'O Canal do Boi traz informações de pecuária, açúcar, milho e soja para todo o Brasil.',
  'Notícias do agronegócio brasileiro: cana-de-açúcar, soja e milho. Inscreva-se no canal.',
  'Somos referência em agronegócio, produção de açúcar e cana-de-açúcar.',
  'Siga nosso canal para acompanhar o mercado de soja e cana-de-açúcar.',
  '#agro #cana #soja #milho',
  'Confira mais em https://example.com/agricultura/cana-de-acucar',
  'Cana-de-açúcar, soja e milho.',
 ];
 for(const description of descriptions)assert.equal(classifyTvVideo('Senado debate PEC e jornada de trabalho',description),null,description);
 assert.equal(classifyTvVideo('STF mantém prisão de empresário','Produtores de cana-de-açúcar comentam a decisão e a produção da próxima safra.'),null);
 assert.equal(classifyTvVideo('Lula anuncia crédito rural para agricultores'),'agro','Real agro legislation remains eligible');
});

test('global optimization reaches ten sugarcane, four grains and six other agro videos with four per channel',()=>{
 const pool=[];
 for(const channelId of channels)for(const category of ['sugarcane','grains','agro'])for(let index=0;index<6;index++)pool.push(video(channelId,category,index*1000+channels.indexOf(channelId)*10000));
 const before=pool.map(item=>item.id),result=curateTvVideos(pool,channels);
 assert.equal(result.length,20);assert.deepEqual(counts(result),{sugarcane:10,grains:4,agro:6});
 for(const channelId of channels)assert.equal(result.filter(item=>item.channelId===channelId).length,4);
 assert.deepEqual(pool.map(item=>item.id),before,'Input ordering is not mutated');
 assert.equal(new Set(result.map(item=>item.id)).size,20);
 for(const selected of result){
  const newer=pool.filter(item=>item.channelId===selected.channelId&&classifyTvVideo(item.title)===classifyTvVideo(selected.title)&&Date.parse(item.publishedAt)>Date.parse(selected.publishedAt));
  assert.ok(newer.every(item=>result.includes(item)),'No older clip replaces a fresher clip in the same channel/topic');
 }
 for(let index=1;index<result.length;index++)assert.ok(Date.parse(result[index-1].publishedAt)>=Date.parse(result[index].publishedAt));
});

test('allocation reserves flexible channels rather than making a greedy locally fresh choice',()=>{
 const pool=[];
 for(const channelId of channels.slice(0,2))for(let index=0;index<4;index++)pool.push(video(channelId,'sugarcane',index));
 for(const category of ['sugarcane','grains','agro'])for(let index=0;index<4;index++)pool.push(video(channels[2],category,index+(category==='sugarcane'?0:1000)));
 for(let index=0;index<4;index++)pool.push(video(channels[3],'agro',index));
 for(const category of ['grains','agro'])for(let index=0;index<4;index++)pool.push(video(channels[4],category,index));
 const result=curateTvVideos(pool,channels);
 assert.equal(result.length,20);assert.deepEqual(counts(result),{sugarcane:10,grains:4,agro:6});
});

test('scarce inventory scales targets to the attainable total and never fills holes with unrelated news',()=>{
 const pool=[];
 for(const channelId of channels.slice(0,2))for(const category of ['sugarcane','grains','agro'])for(let index=0;index<4;index++)pool.push(video(channelId,category,index));
 pool.push(video(channels[2],'sugarcane'),video(channels[2],'agro'));
 for(const channelId of channels.slice(2))for(let index=0;index<8;index++)pool.push(video(channelId,null,index));
 const result=curateTvVideos(pool,channels);
 assert.equal(result.length,10);assert.deepEqual(counts(result),{sugarcane:5,grains:2,agro:3});
 assert.equal(result.filter(item=>item.channelId===channels[2]).length,2);
 assert.equal(result.some(item=>channels.slice(3).includes(item.channelId)),false);
 const oneTopic=Array.from({length:9},(_,index)=>video(channels[0],'sugarcane',index));
 assert.equal(curateTvVideos(oneTopic,channels).length,4,'Ratios never cause unrelated filler or exceed the channel cap');
});

test('channel scope, duplicate IDs, invalid dates and rounded targets remain bounded and deterministic',()=>{
 const pool=[];
 for(const channelId of channels.slice(0,2))for(const category of ['sugarcane','grains','agro'])for(let index=0;index<4;index++)pool.push(video(channelId,category,index));
 pool.push(video(channels[2],'sugarcane'),video('foreign','sugarcane'));
 const duplicate={...pool[0]},invalid=video(channels[0],'grains',0,{publishedAt:'invalid'});
 const selected=[channels[0],channels[1],channels[0],'foreign'];
 const result=curateTvVideos([...pool,duplicate,invalid],selected);
 assert.equal(result.length,8);assert.deepEqual(counts(result),{sugarcane:4,grains:2,agro:2});
 assert.ok(result.every(item=>selected.slice(0,2).includes(item.channelId)));
 assert.equal(new Set(result.map(item=>item.id)).size,result.length);
 assert.deepEqual(curateTvVideos([...pool,duplicate,invalid],selected).map(item=>item.id),result.map(item=>item.id));
 assert.deepEqual(curateTvVideos(pool,[]),[]);assert.deepEqual(curateTvVideos(pool,['foreign']),[]);
});
