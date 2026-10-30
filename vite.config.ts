import vinext from "vinext";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { sites } from "./build/sites-vite-plugin";

export default defineConfig(({ command }) => ({
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Avoid overlapping a browser request with the RSC environments booting.
    open: false,
  },
  ssr: {
    // Keep tslib as native ESM in the Node bundle. Bundling its UMD fallback
    // breaks the Radix dialog stack used by contracts and quotations.
    external: ["tslib", "youtubei.js", "quickjs-emscripten"],
  },
  plugins: [vinext(), ...(command === "build" ? [nitro({
    // Preserve the media parser's classes and QuickJS's relative WASM loader.
    // Nitro produces the deployed server, so its trace must include the binaries.
    traceDeps: [
      "youtubei.js",
      "quickjs-emscripten*",
      "quickjs-emscripten-core*",
      "@jitl/quickjs-wasmfile-release-sync*",
      "@jitl/quickjs-wasmfile-release-asyncify*",
      "@jitl/quickjs-wasmfile-debug-sync*",
      "@jitl/quickjs-wasmfile-debug-asyncify*",
    ],
  })] : []), sites()],
}));
