// These checks present the server's effective permissions. PostgreSQL remains
// responsible for every read and mutation, including direct RPC requests.
export type WorkspaceAccessSnapshot={isOwner:boolean;permissions:readonly string[]};
export const cadastroPermissions:Record<string,string>={
 clientes:'clients.read',funcionarios:'employees.read',prestadores:'service-providers.read',atr:'atr.read',fazenda:'farms.read',contratos:'contract-types.read',categorias:'material-categories.read',materiais:'materials.read',frota:'fleet.read','formas-pagamento':'payment-methods.read',culturas:'cultures.read','tratos-culturais':'cultural-practices.read',assinaturas:'signatures.read','modelos-documentos':'document-templates.read',
};
export const requestPermissions:Record<string,string>={'horas-extras':'overtime.read',servico:'service-requests.read',compras:'purchase-requests.read',cotacao:'quotations.read',pedidos:'purchase-orders.read'};
export const configurationPermissions:Record<string,string>={empresas:'companies.read',usuarios:'users.manage','perfis-acesso':'access-profiles.manage','marca-dagua':'watermarks.read','cabecalho-relatorios':'report-headers.read',importacoes:'imports.read'};
const modulePermissions:Record<string,string>={'/':'home.read','/dashboard':'summary.read','/cotacao':'quotations.read','/pedidos':'purchase-orders.read','/documentacao':'documentation.read','/contratos':'contracts.read','/importacoes':'imports.read','/agenda':'agenda.read','/relatorios':'reports.read'};
export function hasWorkspacePermission(access:WorkspaceAccessSnapshot|undefined,permission:string){return !!access&&(access.isOwner||access.permissions.includes(permission)||(permission==='signatures.read'&&access.permissions.includes('signatures.manage')));}
export function canOpenWorkspaceHref(access:WorkspaceAccessSnapshot|undefined,href:string):boolean{
 if(!access)return false;
 const [path,query='']=href.split('?'),params=new URLSearchParams(query),section=params.get('secao');
 if(path==='/cadastro')return section?!!cadastroPermissions[section]&&hasWorkspacePermission(access,cadastroPermissions[section]):Object.values(cadastroPermissions).some(permission=>hasWorkspacePermission(access,permission));
 if(path==='/solicitacoes')return section?!!requestPermissions[section]&&hasWorkspacePermission(access,requestPermissions[section]):Object.values(requestPermissions).some(permission=>hasWorkspacePermission(access,permission));
 if(path==='/configuracoes'){
  // Account details are personal; they do not confer workspace administration.
  if(section==='perfil')return true;
  return section?!!configurationPermissions[section]&&hasWorkspacePermission(access,configurationPermissions[section]):Object.entries(configurationPermissions).some(([id,permission])=>id!=='importacoes'&&hasWorkspacePermission(access,permission));
 }
 return !!modulePermissions[path]&&hasWorkspacePermission(access,modulePermissions[path]);
}
export function workspaceLandingHref(access:WorkspaceAccessSnapshot|undefined){
 const routes=['/',...Object.keys(cadastroPermissions).map(id=>'/cadastro?secao='+id),...Object.keys(requestPermissions).map(id=>id==='cotacao'?'/cotacao':id==='pedidos'?'/pedidos':'/solicitacoes?secao='+id),'/dashboard','/documentacao','/contratos','/importacoes','/agenda','/relatorios',...Object.keys(configurationPermissions).map(id=>'/configuracoes?secao='+id)];
 return routes.find(href=>canOpenWorkspaceHref(access,href))??null;
}
