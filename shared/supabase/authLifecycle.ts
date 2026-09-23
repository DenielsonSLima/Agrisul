export type AuthSessionTransition = {
  identityChanged: boolean;
  clearQueryCache: boolean;
  blockForAccessValidation: boolean;
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
