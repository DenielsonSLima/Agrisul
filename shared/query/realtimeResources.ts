import {derivedResources} from './derivedResources.ts';
// Events invalidate authorized RPC projections; payloads never populate cache.
const baseResources: Record<string, readonly string[]> = {
  billing_companies: ['companies', 'contracts', 'report-headers'],
  billing_contracts: ['contracts'],
  billing_contract_loads: ['contracts', 'planning'],
  billing_contract_payments: ['contracts'],
  billing_contract_discounts: ['contracts'],
  billing_clients: ['clients', 'contracts'],
  billing_atr_records: ['atr', 'contracts'],
  billing_farms: ['farms', 'plots', 'contracts'],
  billing_farm_plots: ['plots', 'farms', 'contracts', 'planning'],
  billing_contract_types: ['contract-types', 'cultures', 'contracts'],
  billing_cultures: ['cultures', 'contract-types', 'cultural-practices', 'planning'],
  billing_culture_subtypes: ['cultures', 'contract-types', 'cultural-practices', 'planning'],
  billing_cultural_practices: ['cultural-practices', 'planning'],
  billing_planning_periods: ['planning'],
  billing_planning_allocations: ['planning'],
  billing_planning_allocation_practices: ['planning'],
  billing_planning_history: ['planning'],
  billing_planning_harvest_plots: ['planning'],
  billing_planning_harvest_targets: ['planning'],
  billing_planning_field_logs: ['planning'],
  billing_watermarks: ['watermark', 'watermarks', 'report-headers'],
  billing_profiles: ['settings', 'profile', 'users', 'report-headers'],
  billing_memberships: ['companies','contracts','clients','atr','farms','plots','contract-types','cultures','cultural-practices','watermark','watermarks','settings','profile','users','access-profiles','permissions','report-headers'],
  billing_invitations: ['users'],
  billing_access_profiles: ['companies','contracts','clients','atr','farms','plots','contract-types','cultures','cultural-practices','watermark','watermarks','settings','profile','users','access-profiles','permissions','report-headers'],
  billing_user_settings: ['settings', 'profile', 'users', 'report-headers'],
  billing_report_headers: ['report-headers'],
};

export const realtimeResources: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(baseResources).map(([table, resources]) => [table, [...new Set(resources.flatMap(resource => [resource, ...(derivedResources[resource] ?? [])]))]])
);
