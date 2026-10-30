import {EPAGRI_URL,agriculturalProducts,consumeAgriculturalRow,emptyAgriculturalQuotes} from '../../../modules/dashboard-market/providers.mjs';

const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
const decode=text=>text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,(_match,key)=>{
 if(key[0]!=='#')return entities[key.toLowerCase()];
 const value=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
 return value>=0&&value<=0x10ffff?String.fromCodePoint(value):'';
});
const textOf=xml=>[...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(match=>decode(match[1])).join('');

// Read only the seven source columns used by the existing reference parser.
// Avoid building 800k Excel cell objects/styles inside a 2s Edge CPU budget.
export function parseAgriculturalXml(sharedXml,sheets){
 const strings=[...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(match=>textOf(match[1]));
 const quotes=emptyAgriculturalQuotes();
 const selectedPairs=new Set(agriculturalProducts.map(([,product,place])=>`${strings.indexOf(product)}:${strings.indexOf(place)}`));
 for(const xml of sheets){
  for(const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
   // Fast rejection for the source's usual shared-string layout. Alternate
   // layouts still use the general reader, so ordering/inline text stay valid.
   const pair=row[1].match(/<c\b[^>]*\br="D\d+"[^>]*\bt="s"[^>]*>\s*<v>(\d+)<\/v>\s*<\/c>\s*<c\b[^>]*\br="E\d+"[^>]*\bt="s"[^>]*>\s*<v>(\d+)<\/v>/);
   if(pair&&!selectedPairs.has(`${pair[1]}:${pair[2]}`))continue;
   const values=[];
   for(const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const column=cell[1].match(/\br="([A-G])[0-9]+"/)?.[1];
    if(!column||column==='F'||!cell[2])continue;
    const type=cell[1].match(/\bt="([^"]+)"/)?.[1],raw=cell[2].match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
    const value=type==='s'?strings[Number(raw)]:type==='inlineStr'?textOf(cell[2]):raw===undefined?undefined:Number(raw);
    values[column.charCodeAt(0)-64]=value;
   }
   consumeAgriculturalRow(quotes,values);
  }
 }
 return quotes;
}
export function parseAgriculturalWorkbook(bytes,{unzipSync,strFromU8}){
 let size=0;
 const files=unzipSync(bytes,{filter:file=>{
  const selected=/^xl\/(sharedStrings\.xml|worksheets\/sheet[0-9]+\.xml)$/.test(file.name);
  if(selected){size+=file.originalSize;if(size>80_000_000)throw Error('Planilha descompactada acima do limite');}
  return selected;
 }});
 const shared=files['xl/sharedStrings.xml'];
 const sheets=Object.entries(files).filter(([name])=>name.startsWith('xl/worksheets/')).map(([,data])=>strFromU8(data));
 if(!sheets.length)throw Error('Planilha sem dados');
 return parseAgriculturalXml(shared?strFromU8(shared):'',sheets);
}
export async function getAgriculturalFeed(zip){
 const response=await fetch(EPAGRI_URL,{signal:AbortSignal.timeout(30000)});
 if(!response.ok||Number(response.headers.get('content-length'))>12_000_000)throw Error('Planilha indisponível');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.byteLength>12_000_000)throw Error('Planilha acima do limite');
 return {quotes:parseAgriculturalWorkbook(bytes,zip),checkedAt:new Date().toISOString(),refreshSeconds:600};
}
