export const ASSET_PRELOAD_RELOAD_KEY = "billing:asset-preload-reload-at";
export const ASSET_PRELOAD_RELOAD_COOLDOWN_MS = 30_000;

export type AssetPreloadRecoveryRuntime = {
  onPreloadError(listener: (event: Event) => void): () => void;
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

/**
 * Recover once from a stale document requesting chunks from an older build.
 * Vite emits this event when a dynamic import or one of its CSS preloads fails.
 */
export function installAssetPreloadRecovery(runtime: AssetPreloadRecoveryRuntime): () => void {
  return runtime.onPreloadError((event) => {
    if (!runtime.isOnline()) return;

    const timestamp = runtime.now();
    const lastReload = readLastReload(runtime);
    if (lastReload !== null && timestamp - lastReload < ASSET_PRELOAD_RELOAD_COOLDOWN_MS) return;
    if (!rememberReload(runtime, timestamp)) return;

    // Vite otherwise rethrows the preload error after dispatching the event.
    event.preventDefault();
    runtime.reload();
  });
}
