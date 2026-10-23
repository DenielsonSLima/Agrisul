export type ImportTab='open'|'finished'|'settings';
export function importTabFromSearch(params:Pick<URLSearchParams,'get'>):ImportTab{
 const tab=params.get('aba');return tab==='configuracoes'?'settings':tab==='finalizados'?'finished':'open';
}
export function importTabHref(tab:ImportTab){return tab==='settings'?'/importacoes?aba=configuracoes':tab==='finished'?'/importacoes?aba=finalizados':'/importacoes';}
