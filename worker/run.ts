import { closeAllPools, getDb } from "@/db";
import { getConfig } from "@/lib/config";
import { createTraccarSource } from "@/lib/traccar";
import { runWorkerOnce } from "@/lib/worker";

// Runs once and exits, so it can be driven by a systemd timer or by hand (`pnpm worker`).
async function main(): Promise<number> {
  const config = getConfig();
  const summary = await runWorkerOnce({ db: getDb(), config, source: createTraccarSource() });
  return summary.failed > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeAllPools();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error("worker: fatal error:", error instanceof Error ? error.message : error);
    await closeAllPools().catch(() => {});
    process.exit(1);
  });
