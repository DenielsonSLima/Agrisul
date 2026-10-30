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
    external: ["tslib"],
  },
  plugins: [vinext(), ...(command === "build" ? [nitro()] : []), sites()],
}));
