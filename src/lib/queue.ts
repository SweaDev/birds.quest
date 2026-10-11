import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { jobs, type Job, type JobType } from "@/db/schema";

export type EnqueueInput = {
  type: JobType;
  payload?: Record<string, unknown>;
  /** A job with the same key is only ever enqueued once. */
  dedupeKey?: string;
  runAfter?: Date;
  maxAttempts?: number;
};

export type JobHandler = (job: Job, ctx: { db: Db }) => Promise<void>;
export type JobHandlers = Partial<Record<JobType, JobHandler>>;

export type QueueOptions = {
  now?: () => Date;
  /** A running job locked for longer than this is considered abandoned. */
  staleLockMs?: number;
  log?: (message: string) => void;
};

export type RunSummary = { processed: number; succeeded: number; retried: number; failed: number; recovered: number };

const DEFAULT_STALE_LOCK_MS = 15 * 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 60 * 60_000;

/** Delay before retrying after the given (1-based) failed attempt: 30s, 1m, 2m, ... capped at 1h. */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS);
}

export async function enqueueJob(db: Db, input: EnqueueInput): Promise<void> {
  await db
    .insert(jobs)
    .values({
      type: input.type,
      payload: input.payload ?? {},
      dedupeKey: input.dedupeKey,
      // Set explicitly (not via the column default) so tests and callers control the clock.
      runAfter: input.runAfter ?? new Date(),
      ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
}

/**
 * Atomically takes the next due job. `FOR UPDATE SKIP LOCKED` lets several
 * workers claim concurrently without ever receiving the same row.
 */
export async function claimNextJob(db: Db, now: Date = new Date()): Promise<Job | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAfter, now)))
      .orderBy(asc(jobs.runAfter), asc(jobs.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;

    const claimed = { status: "running" as const, lockedAt: now, attempts: row.attempts + 1 };
    await tx.update(jobs).set(claimed).where(eq(jobs.id, row.id));
    return { ...row, ...claimed };
  });
}

export async function completeJob(db: Db, id: number): Promise<void> {
  await db.update(jobs).set({ status: "done", lockedAt: null, lastError: null }).where(eq(jobs.id, id));
}

/** Schedules a retry with backoff, or marks the job failed once attempts are used up. */
export async function failJob(
  db: Db,
  job: Pick<Job, "id" | "attempts" | "maxAttempts">,
  error: unknown,
  now: Date = new Date(),
  { permanent = false }: { permanent?: boolean } = {},
): Promise<"retry" | "failed"> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  if (permanent || job.attempts >= job.maxAttempts) {
    await db.update(jobs).set({ status: "failed", lockedAt: null, lastError: message }).where(eq(jobs.id, job.id));
    return "failed";
  }
  await db
    .update(jobs)
    .set({
      status: "pending",
      lockedAt: null,
      lastError: message,
      runAfter: new Date(now.getTime() + backoffMs(job.attempts)),
    })
    .where(eq(jobs.id, job.id));
  return "retry";
}

/** Puts jobs whose worker died back in the queue (or fails them when out of attempts). */
export async function recoverStaleJobs(db: Db, now: Date, staleLockMs = DEFAULT_STALE_LOCK_MS): Promise<number> {
  const cutoff = new Date(now.getTime() - staleLockMs);
  const [result] = await db
    .update(jobs)
    .set({
      status: sql`IF(${jobs.attempts} >= ${jobs.maxAttempts}, 'failed', 'pending')`,
      lockedAt: null,
      lastError: "Worker stopped before finishing (lock expired)",
      runAfter: now,
    })
    .where(and(eq(jobs.status, "running"), lte(jobs.lockedAt, cutoff)));
  return result.affectedRows;
}

/** Runs due jobs until none are left, then returns. Failed jobs wait for their backoff. */
export async function runQueue(db: Db, handlers: JobHandlers, options: QueueOptions = {}): Promise<RunSummary> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const summary: RunSummary = { processed: 0, succeeded: 0, retried: 0, failed: 0, recovered: 0 };

  summary.recovered = await recoverStaleJobs(db, now(), options.staleLockMs);
  if (summary.recovered > 0) log(`recovered ${summary.recovered} stale job(s)`);

  for (;;) {
    const job = await claimNextJob(db, now());
    if (!job) break;
    summary.processed++;

    const handler = handlers[job.type];
    try {
      if (!handler) throw new NoHandlerError(job.type);
      await handler(job, { db });
      await completeJob(db, job.id);
      summary.succeeded++;
      log(`job ${job.id} (${job.type}) done`);
    } catch (error) {
      const outcome = await failJob(db, job, error, now(), { permanent: error instanceof NoHandlerError });
      if (outcome === "retry") summary.retried++;
      else summary.failed++;
      log(`job ${job.id} (${job.type}) ${outcome === "retry" ? "will retry" : "failed"}: ${(error as Error).message}`);
    }
  }
  return summary;
}

class NoHandlerError extends Error {
  constructor(type: string) {
    super(`No handler registered for job type "${type}"`);
  }
}
