export const marketCatalog = [
  {id:'usd',name:'Dólar',symbol:'USD/BRL',unit:'R$/US$',description:'Dólar em reais · fonte e horário nos detalhes'},
  {id:'eur',name:'Euro',symbol:'EUR/BRL',unit:'R$/€',description:'Euro em reais · fonte e horário nos detalhes'},
  {id:'soy',name:'Soja',symbol:'SOJA',unit:'R$/sc 60 kg',description:'Soja industrial · Oeste/SC'},
  {id:'cane',name:'Cana-de-açúcar',symbol:'CANA',unit:'R$/t',description:'Cana básica no campo · Consecana-PR'},
  {id:'corn',name:'Milho',symbol:'MILHO',unit:'R$/sc 60 kg',description:'Milho-amarelo · Oeste/SC'},
  {id:'cattle',name:'Boi gordo',symbol:'BOI',unit:'R$/@',description:'Boi gordo · Oeste/SC'},
  {id:'wheat',name:'Trigo',symbol:'TRIGO',unit:'R$/sc 60 kg',description:'Trigo superior PH78 · Oeste/SC'},
  {id:'rice',name:'Arroz',symbol:'ARROZ',unit:'R$/sc 50 kg',description:'Arroz irrigado em casca · Litoral Sul/SC'},
  {id:'beans',name:'Feijão',symbol:'FEIJÃO',unit:'R$/sc 60 kg',description:'Feijão-carioca · Oeste/SC'},
  {id:'pork',name:'Suíno vivo',symbol:'SUÍNO',unit:'R$/kg',description:'Produtores independentes · Oeste/SC'},
  {id:'chicken',name:'Frango vivo',symbol:'FRANGO',unit:'R$/kg',description:'Frango de corte · Oeste/SC'},
] as const;
export type MarketId=typeof marketCatalog[number]['id'];
export const defaultMarketIds:MarketId[]=marketCatalog.slice(0,9).map(item=>item.id);
export type MarketQuote={id:MarketId;value:string|null;date:string|null;observedAt?:string;changePercent?:string;source:string;sourceUrl:string;note:string;status:'available'|'stale'|'unavailable'};
export type MarketFeed={quotes:MarketQuote[];checkedAt:string;refreshSeconds:number};

export function readMarketSelection(raw:string|null):MarketId[]{
  if(!raw)return [...defaultMarketIds];
  try{
    const value:unknown=JSON.parse(raw);
    if(!Array.isArray(value))return [...defaultMarketIds];
    const ids=marketCatalog.filter(item=>value.includes(item.id)).map(item=>item.id);
    return ids.length?ids:[...defaultMarketIds];
  }catch{return [...defaultMarketIds];}
}
