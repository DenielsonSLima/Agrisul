"use client";

import { useEffect } from "react";
import { installAssetPreloadRecovery } from "./assetPreloadRecovery";

export function AssetPreloadRecovery() {
  useEffect(() => installAssetPreloadRecovery({
    onPreloadError(listener) {
      window.addEventListener("vite:preloadError", listener);
      return () => window.removeEventListener("vite:preloadError", listener);
    },
    isOnline: () => window.navigator.onLine,
    readStorage: (key) => window.sessionStorage.getItem(key),
    writeStorage: (key, value) => window.sessionStorage.setItem(key, value),
    reload: () => window.location.reload(),
    now: () => Date.now(),
  }), []);

  return null;
}
