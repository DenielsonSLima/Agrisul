export type BillingUserStatus = 'pending' | 'active' | 'inactive';

export type BillingUser = {
  id: string;
  name: string;
  email: string;
  status: BillingUserStatus;
  accessProfileId: string | null;
  accessProfileName: string;
  isOwner: boolean;
  deliveryStatus?: 'queued' | 'sent' | 'failed';
  expiresAt?: string | null;
  updatedAt?: string | null;
};

export type UserInviteInput = {
  email: string;
  accessProfileId: string;
};
