export type AccessProfile = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  userCount: number;
  updatedAt?: string | null;
};

export type AccessProfileInput = Pick<AccessProfile,'name'|'description'|'permissions'>;

export type PermissionOption = {key:string;label:string};
export type PermissionGroup = {label:string;options:PermissionOption[]};

export const permissionGroups:PermissionGroup[]=[
  {label:'Empresas',options:[{key:'companies.read',label:'Consultar'},{key:'companies.write',label:'Cadastrar, editar e excluir'}]},
  {label:'Cadastros',options:[{key:'registrations.read',label:'Consultar'},{key:'registrations.write',label:'Cadastrar, editar e excluir'}]},
  {label:'Contratos',options:[{key:'contracts.read',label:'Consultar'},{key:'contracts.write',label:'Cadastrar, editar e excluir'}]},
  {label:'Solicitações',options:[{key:'requests.read',label:'Consultar solicitações'},{key:'requests.write',label:'Registrar solicitações'},{key:'requests.approve',label:'Aprovar e recusar como diretor geral'}]},
  {label:'Assinaturas',options:[{key:'signatures.manage',label:'Cadastrar e administrar assinaturas'}]},
  {label:'Meu perfil e espaço',options:[{key:'settings.write',label:'Alterar dados do espaço'}]},
  {label:'Marca d’água',options:[{key:'watermarks.read',label:'Consultar'},{key:'watermarks.write',label:'Alterar'}]},
  {label:'Usuários',options:[{key:'users.manage',label:'Listar, convidar e administrar'}]},
  {label:'Perfis de acesso',options:[{key:'access-profiles.manage',label:'Listar e administrar'}]},
  {label:'Cabeçalhos e modelos de documentos',options:[{key:'report-headers.read',label:'Consultar'},{key:'report-headers.write',label:'Editar cabeçalhos e modelos'}]},
];
