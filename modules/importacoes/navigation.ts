export type ImportTab='open'|'finished'|'settings';
export function importTabFromSearch(params:Pick<URLSearchParams,'get'>):ImportTab{
 const tab=params.get('aba');return tab==='configuracoes'?'settings':tab==='finalizados'?'finished':'open';
}
export function importTabHref(tab:ImportTab){return tab==='settings'?'/importacoes?aba=configuracoes':tab==='finished'?'/importacoes?aba=finalizados':'/importacoes';}
export type ImportClientFilters={dateFrom?:string;dateTo?:string;farm?:string;plot?:string;groupBy?:'none'|'day'|'farm'|'plot'|'source-group';columnFilters?:Record<string,string[]>;sortKey?:string;sortDirection?:'asc'|'desc'};
export function importClientFiltersFromSearch(params:Pick<URLSearchParams,'get'>):ImportClientFilters{
 const groupBy=params.get('agrupar');let columnFilters:Record<string,string[]>|undefined;
 try{const value:unknown=JSON.parse(params.get('colunas')||'null');if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(values=>Array.isArray(values)&&values.every(item=>typeof item==='string')))columnFilters=value as Record<string,string[]>;}catch{/* Invalid URL filters are ignored. */}
 return {dateFrom:params.get('de')||undefined,dateTo:params.get('ate')||undefined,farm:params.get('fazenda')||undefined,plot:params.get('talhao')||undefined,groupBy:groupBy==='day'||groupBy==='farm'||groupBy==='plot'||groupBy==='source-group'?groupBy:'none',...(columnFilters?{columnFilters}:{}),...(params.get('ordem')?{sortKey:params.get('ordem')!,sortDirection:params.get('sentido')==='desc'?'desc' as const:'asc' as const}:{})};
}
function appendClientFilters(params:URLSearchParams,filters?:ImportClientFilters){if(!filters)return;const values:Array<[string,string|undefined]>=[['de',filters.dateFrom],['ate',filters.dateTo],['fazenda',filters.farm],['talhao',filters.plot],['agrupar',filters.groupBy==='none'?undefined:filters.groupBy],['colunas',filters.columnFilters&&Object.keys(filters.columnFilters).length?JSON.stringify(filters.columnFilters):undefined],['ordem',filters.sortKey],['sentido',filters.sortKey?filters.sortDirection:undefined]];for(const [key,value] of values)if(value)params.set(key,value);}
export function importDocumentHref(id:string,options:{tab?:ImportTab;date?:string;entryId?:string;newEntry?:boolean;clientId?:string;returnToClient?:boolean;filters?:ImportClientFilters}={}){
 const params=new URLSearchParams();if(options.tab==='finished')params.set('aba','finalizados');params.set('documento',id);
 if(options.clientId)params.set('cliente',options.clientId);if(options.date)params.set('dia',options.date);if(options.entryId)params.set('lancamento',options.entryId);else if(options.newEntry)params.set('novo','1');
 if(options.returnToClient)params.set('retorno','cliente');
 appendClientFilters(params,options.filters);
 return '/importacoes?'+params.toString();
}
export function importUploadHref(clientId?:string){return '/importacoes?importar=1'+(clientId?'&cliente='+encodeURIComponent(clientId):'');}
export function importClientHref(clientId:string,tab:ImportTab='open',filters?:ImportClientFilters){const params=new URLSearchParams();if(tab==='finished')params.set('aba','finalizados');params.set('cliente',clientId);appendClientFilters(params,filters);return '/importacoes?'+params.toString();}
export function importProfileHref(id?:string){return '/importacoes?aba=configuracoes'+(id?'&modelo='+encodeURIComponent(id):'&novoModelo=1');}
export function importCloneProfileHref(id:string){return '/importacoes?aba=configuracoes&clonar='+encodeURIComponent(id);}
