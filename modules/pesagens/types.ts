export type WeighingSummary = {
  entryCount: number;
  completeCount: number;
  pendingCount: number;
  agrisulNetKg: string | null;
  partnerNetKg: string | null;
  differenceKg: string | null;
  differencePercent: string | null;
};

export type WeighingControl = {
  id: string;
  companyId: string;
  partnerId: string;
  partnerName: string;
  startDate: string;
  season: string;
  notes: string;
  summary: WeighingSummary;
};

export type WeighingComponentInput = {
  fleetNumber: string;
  plate: string;
  kind: 'truck' | 'trailer';
  tareKg: string | null;
  grossKg: string | null;
  partnerNetKg: string | null;
};

export type WeighingComponent = WeighingComponentInput & {netKg: string | null; differenceKg?: string | null};
export type WeighingEntryInput = {
  weighedAt: string;
  weighedTime: string;
  ticket: string;
  notes: string;
  trailerGrossMode: 'combined' | 'individual';
  combinedTrailerGrossKg: string | null;
  components: WeighingComponentInput[];
};
export type WeighingEntry = Omit<WeighingEntryInput, 'components'> & {
  id: string;
  controlId: string;
  components: WeighingComponent[];
  agrisulNetKg: string | null;
  partnerNetKg: string | null;
  partnerComplete: boolean;
  differenceKg: string | null;
  differencePercent: string | null;
};
export type WeighingControlInput = {partnerId: string; startDate: string; season: string; notes: string};
export type WeighingList = {controls: WeighingControl[]; canManage: boolean};
export type WeighingDetail = {
  control: WeighingControl;
  entries: WeighingEntry[];
  daily: (WeighingSummary & {date: string})[];
  summary: WeighingSummary;
  canManage: boolean;
};
