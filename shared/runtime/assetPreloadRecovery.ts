export const ASSET_PRELOAD_RELOAD_KEY = "billing:asset-preload-reload-at";
export const ASSET_PRELOAD_RELOAD_COOLDOWN_MS = 30_000;

export type AssetPreloadRecoveryRuntime = {
  onPreloadError(listener: (event: Event) => void): () => void;
  onUnhandledRejection(listener: (event: PromiseRejectionEvent) => void): () => void;
  isOnline(): boolean;
  readStorage(key: string): string | null;
  writeStorage(key: string, value: string): void;
  reload(): void;
  now(): number;
};

function readLastReload(runtime: AssetPreloadRecoveryRuntime): number | null {
  try {
    const stored = runtime.readStorage(ASSET_PRELOAD_RELOAD_KEY);
    if (stored === null || stored.trim() === "") return null;
    const value = Number(stored);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function rememberReload(runtime: AssetPreloadRecoveryRuntime, timestamp: number): boolean {
  try {
    runtime.writeStorage(ASSET_PRELOAD_RELOAD_KEY, String(timestamp));
    return true;
  } catch {
    // Never risk an unbounded reload loop when browser storage is unavailable.
    return false;
  }
}

export function isMissingNextStylesheet(reason: unknown): boolean {
  let message: unknown;
  try {
    message = typeof reason === 'string' ? reason :
      reason !== null && typeof reason === 'object' && 'message' in reason ? reason.message : null;
  } catch { return false; }
  return typeof message === 'string' &&
    /^No link element found for chunk (?:https?:\/\/[^\s/]+)?\/_next\/static\/chunks\/[^\s]+\.css(?:[?#][^\s]*)?$/.test(message);
}

/** Recover from a stale asset once per cooldown, shared across both bundlers. */
export function installAssetPreloadRecovery(runtime: AssetPreloadRecoveryRuntime): () => void {
  const recover = (event: Event) => {
    if (!runtime.isOnline()) return;

    const timestamp = runtime.now();
    const lastReload = readLastReload(runtime);
    if (lastReload !== null && timestamp - lastReload < ASSET_PRELOAD_RELOAD_COOLDOWN_MS) return;
    if (!rememberReload(runtime, timestamp)) return;

    // Preserve unrelated errors and avoid rethrowing an asset error while the
    // fresh document is loading. Storage survives that reload to bound retries.
    event.preventDefault();
    runtime.reload();
  };
  const disposePreload = runtime.onPreloadError(recover);
  const disposeRejection = runtime.onUnhandledRejection((event) => {
    if (isMissingNextStylesheet(event.reason)) recover(event);
  });
  return () => { disposePreload(); disposeRejection(); };
}
