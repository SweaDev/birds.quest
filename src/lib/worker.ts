import type { Db } from "@/db";
import { buildHandlers, type HandlerDeps } from "./handlers";
import { enqueueJob, pruneJobs, runQueue, type RunSummary } from "./queue";

export type WorkerDeps = HandlerDeps & { db: Db; log?: (message: string) => void };

/** One worker pass: enqueue a `discover` job, then drain the queue and return. */
export async function runWorkerOnce({ db, log = console.log, ...deps }: WorkerDeps): Promise<RunSummary> {
  const now = deps.now ?? (() => new Date());
  log("worker: start");

  const pruned = await pruneJobs(db, now());
  if (pruned > 0) log(`worker: pruned ${pruned} old job(s)`);

  await enqueueJob(db, { type: "discover", runAfter: now() });
  const summary = await runQueue(db, buildHandlers({ ...deps, log }), { now, log: (m) => log(`worker: ${m}`) });

  log(
    `worker: finished, ${summary.processed} job(s) processed ` +
      `(${summary.succeeded} ok, ${summary.retried} to retry, ${summary.failed} failed)`,
  );
  return summary;
}
