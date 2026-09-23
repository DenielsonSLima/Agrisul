// Mutations refresh projections even when Realtime is unavailable.
export const derivedResources: Record<string, readonly string[]> = {
  signatures: ['service-requests'],
  'service-providers': ['service-requests', 'home'],
  'document-templates': ['service-requests'],
  contracts: ['agenda', 'summary', 'reports', 'planning', 'home'],
  companies: ['agenda', 'summary', 'reports', 'service-requests', 'home'],
  'report-headers': ['service-requests'],
  clients: ['agenda', 'summary', 'reports', 'home'],
  atr: ['summary', 'reports', 'home'],
  farms: ['agenda', 'summary', 'reports', 'planning', 'home'],
  plots: ['agenda', 'summary', 'reports', 'planning', 'home'],
  cultures: ['planning', 'home'],
  'cultural-practices': ['planning', 'home'],
  planning: ['farms', 'plots', 'summary', 'home'],
  'contract-types': ['summary', 'reports', 'home'],
  'material-categories': ['materials'],
  'payment-methods': ['purchase-orders'],
  'service-requests': ['home'],
  'access-profiles': ['home'],
  users: ['home'],
  quotations: ['purchase-orders'],
};
export function mutationResources(resource: string, related: readonly string[] = []) {
  return [...new Set([resource, ...related].flatMap(key => [key, ...(derivedResources[key] ?? [])]))];
}
