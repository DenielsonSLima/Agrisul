import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
const managedLinux = readExecutionProfile() === "managed-linux";

async function reuseDevServer() {
  let existing;
  try {
    existing = JSON.parse(readFileSync(resolve(".vinext/dev/lock.json"), "utf8"));
    if (typeof existing.cwd !== "string" || resolve(existing.cwd) !== process.cwd()
      || !Number.isSafeInteger(existing.pid) || existing.pid <= 0) return false;

    try {
      // Signal 0 only checks whether the lock's owner still exists.
      process.kill(existing.pid, 0);
    } catch (error) {
      if (error.code !== "EPERM") return false;
    }

    // Probe Vite itself without rendering an application page.
    const endpoint = new URL("/@vite/client", existing.appUrl);
    if (!["http:", "https:"].includes(endpoint.protocol)) return false;
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(3000),
      redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok || !response.headers.get("content-type")?.includes("javascript")) return false;
  } catch {
    // Missing/stale locks and unavailable servers follow Vinext's normal startup.
    return false;
  }

  console.log(`\n  Controle de Faturamento disponível em ${existing.appUrl}`);
  console.log("  Reutilizando o servidor ativo. As alterações continuam sendo atualizadas automaticamente.\n");
  return true;
}

// Explicit CLI options (including --help) must still be handled by Vinext.
if (!managedLinux && command === "dev" && args.length === 0
  && process.env.VINEXT_NO_DEV_LOCK !== "1" && await reuseDevServer()) {
  process.exit(0);
}

if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
await import(cli.href);
