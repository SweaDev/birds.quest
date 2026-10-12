import "server-only";
import { getDb } from "@/db";
import { getConfig } from "./config";
import type { RunSummary } from "./queue";

type RunState = { running: boolean; startedAt?: Date; finishedAt?: Date; summary?: RunSummary; error?: string };

// One state per server process; `next start` is a single long-running process.
const g = globalThis as unknown as { __bqRun?: RunState };
const state = (): RunState => (g.__bqRun ??= { running: false });

export function getRunState(): RunState {
  return { ...state() };
}

/**
 * Starts one worker pass (discover trips, drain the queue) in the background.
 * Returns false if one is already running. Posts can take minutes, so this never waits.
 */
export function triggerWorker(): boolean {
  const current = state();
  if (current.running) return false;
  Object.assign(current, { running: true, startedAt: new Date(), finishedAt: undefined, error: undefined });

  void (async () => {
    try {
      // Loaded lazily: this pulls in the ONNX runtime.
      const [{ runWorkerOnce }, { createTraccarSource }] = await Promise.all([
        import("./worker"),
        import("./traccar"),
      ]);
      current.summary = await runWorkerOnce({ db: getDb(), config: getConfig(), source: createTraccarSource() });
    } catch (error) {
      current.error = error instanceof Error ? error.message : String(error);
      console.error("run queue now failed:", current.error);
    } finally {
      current.running = false;
      current.finishedAt = new Date();
    }
  })();
  return true;
}
