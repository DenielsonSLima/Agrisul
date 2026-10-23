export type ImportTab='open'|'finished'|'settings';
export function importTabFromSearch(params:Pick<URLSearchParams,'get'>):ImportTab{
 const tab=params.get('aba');return tab==='configuracoes'?'settings':tab==='finalizados'?'finished':'open';
}
export function importTabHref(tab:ImportTab){return tab==='settings'?'/importacoes?aba=configuracoes':tab==='finished'?'/importacoes?aba=finalizados':'/importacoes';}
export function importDocumentHref(id:string,options:{tab?:ImportTab;date?:string;entryId?:string;newEntry?:boolean;clientId?:string;returnToClient?:boolean}={}){
 const params=new URLSearchParams();if(options.tab==='finished')params.set('aba','finalizados');params.set('documento',id);
 if(options.clientId)params.set('cliente',options.clientId);if(options.date)params.set('dia',options.date);if(options.entryId)params.set('lancamento',options.entryId);else if(options.newEntry)params.set('novo','1');
 if(options.returnToClient)params.set('retorno','cliente');
 return '/importacoes?'+params.toString();
}
export function importUploadHref(clientId?:string){return '/importacoes?importar=1'+(clientId?'&cliente='+encodeURIComponent(clientId):'');}
export function importClientHref(clientId:string,tab:ImportTab='open'){return '/importacoes?'+(tab==='finished'?'aba=finalizados&':'')+'cliente='+encodeURIComponent(clientId);}
export function importProfileHref(id?:string){return '/importacoes?aba=configuracoes'+(id?'&modelo='+encodeURIComponent(id):'&novoModelo=1');}
export function importCloneProfileHref(id:string){return '/importacoes?aba=configuracoes&clonar='+encodeURIComponent(id);}
