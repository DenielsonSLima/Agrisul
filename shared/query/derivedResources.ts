// Mutations refresh projections even when Realtime is unavailable.
export const derivedResources: Record<string, readonly string[]> = {
  employees: ['overtime'],
  signatures: ['service-requests'],
  'service-providers': ['service-requests', 'home', 'documentation'],
  'document-templates': ['service-requests'],
  contracts: ['agenda', 'summary', 'reports', 'planning', 'home', 'import-documents'],
  companies: ['agenda', 'summary', 'reports', 'service-requests', 'home', 'cane-weighings', 'documentation', 'overtime'],
  'report-headers': ['service-requests'],
  clients: ['agenda', 'summary', 'reports', 'home', 'cane-weighings', 'fleet', 'import-profiles', 'import-documents'],
  fleet: ['cane-weighings', 'purchase-requests'],
  atr: ['summary', 'reports', 'home'],
  farms: ['agenda', 'summary', 'reports', 'planning', 'home', 'import-documents'],
  plots: ['agenda', 'summary', 'reports', 'planning', 'home', 'import-documents'],
  cultures: ['planning', 'home'],
  'cultural-practices': ['planning', 'home'],
  planning: ['farms', 'plots', 'summary', 'home'],
  'contract-types': ['summary', 'reports', 'home'],
  'material-categories': ['materials', 'purchase-requests'],
  materials: ['purchase-requests'],
  'payment-methods': ['purchase-orders'],
  'service-requests': ['home', 'documentation'],
  'access-profiles': ['home'],
  users: ['home'],
  'import-profiles': ['import-documents'],
  'import-documents': ['contracts', 'summary', 'planning', 'home', 'reports'],
  quotations: ['purchase-orders', 'documentation'],
  'purchase-orders': ['documentation'],
};
export function mutationResources(resource: string, related: readonly string[] = []) {
  return [...new Set([resource, ...related].flatMap(key => [key, ...(derivedResources[key] ?? [])]))];
}
