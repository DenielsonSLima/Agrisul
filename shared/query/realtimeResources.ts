import {derivedResources} from './derivedResources.ts';
// Events invalidate authorized RPC projections; payloads never populate cache.
const baseResources: Record<string, readonly string[]> = {
  billing_companies: ['companies', 'contracts', 'report-headers', 'service-requests'],
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
  billing_profiles: ['settings', 'profile', 'users', 'report-headers', 'signatures', 'service-requests'],
  billing_memberships: ['companies','contracts','clients','atr','farms','plots','contract-types','cultures','cultural-practices','watermark','watermarks','settings','profile','users','access-profiles','permissions','report-headers','signatures','service-requests','document-templates','service-providers'],
  billing_invitations: ['users'],
  billing_access_profiles: ['companies','contracts','clients','atr','farms','plots','contract-types','cultures','cultural-practices','watermark','watermarks','settings','profile','users','access-profiles','permissions','report-headers','signatures','service-requests','document-templates','service-providers'],
  billing_user_settings: ['settings', 'profile', 'users', 'report-headers', 'signatures', 'service-requests'],
  billing_report_headers: ['report-headers', 'service-requests'],
  billing_signatures: ['signatures', 'service-requests'],
  billing_service_providers: ['service-providers', 'service-requests'],
  billing_request_files: ['signatures', 'service-requests'],
  billing_service_requests: ['service-requests'],
  billing_service_request_events: ['service-requests'],
  billing_service_request_complements: ['service-requests'],
  billing_document_templates: ['document-templates', 'service-requests'],
};

export const realtimeResources: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(baseResources).map(([table, resources]) => [table, [...new Set(resources.flatMap(resource => [resource, ...(derivedResources[resource] ?? [])]))]])
);
