export function sidebarGroupHasActiveChild(
  groupPath: string,
  pathname: string,
  section: string | null,
) {
  if (groupPath === '/cadastro') return pathname === '/cadastro';
  if (groupPath === '/solicitacoes') {
    return pathname === '/cotacao' || (pathname === '/solicitacoes' && section === 'servico');
  }
  return false;
}

export function sidebarGroupIsExpanded(activeChild: boolean, interactionExpanded: boolean) {
  return activeChild || interactionExpanded;
}
