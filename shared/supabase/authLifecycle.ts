export type AuthSessionTransition = {
  identityChanged: boolean;
  clearQueryCache: boolean;
  blockForAccessValidation: boolean;
};

export type MembershipRealtimeChange = {
  eventType?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
};

/**
 * Auth events can be emitted repeatedly for the same signed-in user (for
 * example when a browser tab becomes visible again). Only an actual identity
 * change may tear down the current workspace while access is validated.
 */
export function planAuthSessionTransition(
  currentUserId: string | null,
  nextUserId: string | null,
): AuthSessionTransition {
  const identityChanged = currentUserId !== nextUserId;
  return {
    identityChanged,
    clearQueryCache: identityChanged,
    blockForAccessValidation: identityChanged && nextUserId !== null,
  };
}

export function canApplyAccessCheck(
  checkRevision: number,
  currentRevision: number,
  checkedUserId: string | null,
  currentUserId: string | null,
) {
  return checkRevision === currentRevision && checkedUserId === currentUserId;
}

/**
 * UPDATE and INSERT payloads contain the new membership, so unrelated members
 * must not cause the current workspace to be torn down. With RLS, DELETE old
 * records can contain only the primary key; an unidentified delete is therefore
 * conservatively revalidated.
 */
export function shouldRefreshAccessForMembershipChange(
  currentUserId: string,
  change: MembershipRealtimeChange,
) {
  const nextUserId = typeof change.new?.user_id === 'string' ? change.new.user_id : null;
  const previousUserId = typeof change.old?.user_id === 'string' ? change.old.user_id : null;
  if (nextUserId || previousUserId) return nextUserId === currentUserId || previousUserId === currentUserId;
  return change.eventType === 'DELETE';
}
