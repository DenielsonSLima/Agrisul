import type {AgendaEvent} from '@/modules/agenda/types';

export type HomePermissions = {
  contracts: boolean; registrations: boolean; requests: boolean; summary: boolean;
  companies: boolean; createCompany: boolean; createContract: boolean; createRequest: boolean;
};
export type HomeContract = {id: string; label: string; clientName: string};
export type HomeData = {
  today: string; month: string; generatedAt: string; permissions: HomePermissions;
  finance: null | {
    scope: 'company'; loadCount: number; loadedVolume: string; netAmount: string;
    receivedAmount: string; pendingLoadCount: number; contractCount: number;
    activeContractCount: number; pendingContracts: HomeContract[];
  };
  contracts: null | {
    overdueCount: number; endingSoonCount: number;
    items: (HomeContract & {endDate: string; overdue: boolean})[];
  };
  agenda: null | {from: string; to: string; total: number; todayCount: number; items: AgendaEvent[]};
  requests: null | {
    scope: 'workspace'; pendingCount: number; inProgressCount: number; overdueCount: number;
    items: {id: string; number: number; providerName: string; requesterName: string;
      createdAt: string; returnDate: string | null; status: 'open' | 'in_progress'; overdue: boolean | null}[];
  };
  planning: null | {
    scope: 'workspace'; id: string; name: string; endDate: string; asOf: string; activePeriodCount: number;
    targetAreaHa: string; allocatedAreaHa: string; plantedAreaHa: string;
    harvestTargetTons: string; harvestedTons: string; plantingPercent: string; harvestPercent: string;
  };
  registrations: null | {scope: 'workspace'; clientCount: number; farmCount: number; plotCount: number; providerCount: number; farmAreaHa: string};
};
