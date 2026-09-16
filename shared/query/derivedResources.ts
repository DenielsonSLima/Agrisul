// Mutations refresh projections even when Realtime is unavailable.
export const derivedResources: Record<string, readonly string[]> = {
  contracts: ['agenda', 'summary', 'reports', 'planning'],
  companies: ['agenda', 'summary', 'reports'],
  clients: ['agenda', 'summary', 'reports'],
  atr: ['summary', 'reports'],
  farms: ['agenda', 'reports', 'planning'],
  plots: ['agenda', 'reports', 'planning'],
  cultures: ['planning'],
  'cultural-practices': ['planning'],
  planning: ['farms', 'plots'],
  'contract-types': ['summary', 'reports'],
};
export function mutationResources(resource: string, related: readonly string[] = []) {
  return [...new Set([resource, ...related].flatMap(key => [key, ...(derivedResources[key] ?? [])]))];
}
