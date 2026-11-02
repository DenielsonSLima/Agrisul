export type PermissionOption = {key: string; label: string; requires?: string[]};
export type PermissionSubmodule = {id: string; label: string; options: PermissionOption[]};
export type PermissionGroup = {id: string; label: string; submodules: PermissionSubmodule[]};

const readWrite = (id: string, label: string, writeLabel = 'Cadastrar, editar e excluir'): PermissionSubmodule => ({
  id,
  label,
  options: [
    {key: `${id}.read`, label: 'Consultar'},
    {key: `${id}.write`, label: writeLabel, requires: [`${id}.read`]},
  ],
});
const readOnly = (id: string, label: string): PermissionSubmodule => ({id, label, options: [{key: `${id}.read`, label: 'Consultar e exportar'}]});

// Each option grants access to one resource. Selecting a module is only a UI
// shortcut for selecting its individual submodules; it creates no broad grant.
export const permissionGroups: PermissionGroup[] = [
  {id: 'home', label: 'Início', submodules: [readOnly('home', 'Visão inicial')]},
  {id: 'summary', label: 'Dashboard', submodules: [readOnly('summary', 'Indicadores')]},
  {id: 'registrations', label: 'Cadastros', submodules: [
    readWrite('clients', 'Clientes'),
    readWrite('employees', 'Funcionários'),
    readWrite('service-providers', 'Prestadores'),
    readWrite('atr', 'ATR'),
    readWrite('farms', 'Fazendas e talhões'),
    readWrite('contract-types', 'Tipos de contrato'),
    readWrite('material-categories', 'Categorias'),
    readWrite('materials', 'Materiais'),
    readWrite('fleet', 'Frota'),
    readWrite('payment-methods', 'Formas de pagamento'),
    readWrite('cultures', 'Culturas'),
    readWrite('cultural-practices', 'Manejo'),
    {id: 'signatures', label: 'Assinaturas', options: [{key: 'signatures.read', label: 'Consultar'}, {key: 'signatures.manage', label: 'Consultar e administrar', requires: ['signatures.read']}]},
    readWrite('document-templates', 'Modelos de documentos', 'Editar modelos'),
  ]},
  {id: 'requests', label: 'Solicitações', submodules: [
    readWrite('overtime', 'Relatório de hora extra'),
    {...readWrite('service-requests', 'Serviço', 'Registrar e acompanhar solicitações'), options: [
      ...readWrite('service-requests', 'Serviço', 'Registrar e acompanhar solicitações').options,
      {key: 'service-requests.approve', label: 'Aprovar e recusar como diretor geral', requires: ['service-requests.read']},
    ]},
    readWrite('purchase-requests', 'Compras'),
    readWrite('quotations', 'Cotação'),
    readWrite('purchase-orders', 'Pedidos'),
  ]},
  {id: 'documentation', label: 'Documentação', submodules: [readWrite('documentation', 'Documentos e pendências', 'Anexar, vincular e conferir documentos')]},
  {id: 'contracts', label: 'Contratos', submodules: [readWrite('contracts', 'Contratos operacionais')]},
  {id: 'imports', label: 'Importações PDF / Excel', submodules: [readWrite('imports', 'Importações')]},
  {id: 'planning', label: 'Planejamento', submodules: [readWrite('planning', 'Metas, plantio, manejo e colheita')]},
  {id: 'agenda', label: 'Agenda', submodules: [readOnly('agenda', 'Eventos e calendário')]},
  {id: 'reports', label: 'Relatórios', submodules: [readOnly('reports', 'Relatórios operacionais')]},
  {id: 'settings', label: 'Configurações', submodules: [
    readWrite('companies', 'Empresas'),
    {id: 'settings', label: 'Espaço de trabalho', options: [{key: 'settings.write', label: 'Alterar identificação do espaço'}]},
    {id: 'users', label: 'Usuários', options: [{key: 'users.manage', label: 'Listar, convidar e administrar'}]},
    {id: 'access-profiles', label: 'Perfis de acesso', options: [{key: 'access-profiles.manage', label: 'Listar e administrar'}]},
    readWrite('watermarks', 'Marca d’água', 'Alterar'),
    {id: 'report-headers', label: 'Cabeçalho de relatórios', options: [
      {key: 'report-headers.read', label: 'Consultar', requires: ['companies.read', 'watermarks.read']},
      {key: 'report-headers.write', label: 'Editar cabeçalhos', requires: ['report-headers.read', 'companies.read', 'watermarks.read']},
    ]},
  ]},
];

export const permissionOptions = permissionGroups.flatMap(group => group.submodules.flatMap(submodule => submodule.options));
export const permissionKeys = permissionOptions.map(option => option.key);

export function toggleProfilePermissions(current: ReadonlySet<string>, keys: string[], checked: boolean): Set<string> {
  const next = new Set(current);
  if (checked) {
    const add = (key: string) => {
      next.add(key);
      permissionOptions.find(option => option.key === key)?.requires?.forEach(add);
    };
    keys.forEach(add);
  } else {
    keys.forEach(key => next.delete(key));
    // A removed read also removes any write or dependent configuration access.
    let removed = true;
    while (removed) {
      removed = false;
      for (const option of permissionOptions) {
        if (next.has(option.key) && option.requires?.some(key => !next.has(key))) {
          next.delete(option.key);
          removed = true;
        }
      }
    }
  }
  return next;
}

export function profileAccessSummary(permissions: readonly string[]): string[] {
  const granted = new Set(permissions);
  return permissionGroups.flatMap(group => group.submodules
    .filter(submodule => submodule.options.some(option => granted.has(option.key)))
    .map(submodule => `${group.label} / ${submodule.label}`));
}
