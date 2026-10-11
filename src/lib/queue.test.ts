import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs } from "@/db/schema";
import { getTestDb, hasTestDb, resetTestDb } from "@/test/db";
import {
  backoffMs,
  claimNextJob,
  enqueueJob,
  failJob,
  pruneJobs,
  recoverStaleJobs,
  runQueue,
} from "./queue";

describe("backoffMs", () => {
  it("doubles per attempt and is capped", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(60 * 60_000);
  });
});

describe.skipIf(!hasTestDb)("queue (database)", () => {
  const db = getTestDb();
  const t0 = new Date("2026-06-01T12:00:00.000Z");
  const after = (ms: number) => new Date(t0.getTime() + ms);

  beforeEach(() => resetTestDb(db));

  const row = async (id: number) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];

  it("claims due jobs in order and marks them running", async () => {
    await enqueueJob(db, { type: "predict", payload: { n: 2 }, runAfter: after(-1000) });
    await enqueueJob(db, { type: "predict", payload: { n: 1 }, runAfter: after(-2000) });
    await enqueueJob(db, { type: "generate", payload: { n: 3 }, runAfter: after(60_000) });

    const first = await claimNextJob(db, t0);
    const second = await claimNextJob(db, t0);
    const third = await claimNextJob(db, t0);

    expect(first?.payload).toEqual({ n: 1 });
    expect(first).toMatchObject({ status: "running", attempts: 1 });
    expect(second?.payload).toEqual({ n: 2 });
    expect(third).toBeNull();
    expect((await row(first!.id)).lockedAt).toEqual(t0);
  });

  it("ignores a second enqueue with the same dedupe key", async () => {
    await enqueueJob(db, { type: "predict", dedupeKey: "predict:1", runAfter: t0 });
    await enqueueJob(db, { type: "predict", dedupeKey: "predict:1", runAfter: t0 });
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("never hands the same job to concurrent claimers (SKIP LOCKED)", async () => {
    for (let i = 0; i < 5; i++) await enqueueJob(db, { type: "predict", payload: { i }, runAfter: after(-1000) });

    const claims = await Promise.all(Array.from({ length: 12 }, () => claimNextJob(db, t0)));
    const ids = claims.filter((c) => c !== null).map((c) => c!.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it("retries with backoff, then fails after max attempts", async () => {
    await enqueueJob(db, { type: "predict", runAfter: after(-1000), maxAttempts: 2 });

    const first = (await claimNextJob(db, t0))!;
    expect(await failJob(db, first, new Error("boom"), t0)).toBe("retry");
    const afterFirst = await row(first.id);
    expect(afterFirst).toMatchObject({ status: "pending", attempts: 1, lastError: "boom" });
    expect(afterFirst.runAfter).toEqual(after(backoffMs(1)));
    expect(await claimNextJob(db, after(backoffMs(1) - 1))).toBeNull();

    const second = (await claimNextJob(db, after(backoffMs(1))))!;
    expect(second.attempts).toBe(2);
    expect(await failJob(db, second, new Error("boom again"), t0)).toBe("failed");
    expect(await row(first.id)).toMatchObject({ status: "failed", lastError: "boom again", lockedAt: null });
  });

  it("recovers jobs whose worker died, and fails them when out of attempts", async () => {
    await enqueueJob(db, { type: "predict", runAfter: after(-1000), maxAttempts: 3 });
    await enqueueJob(db, { type: "generate", runAfter: after(-1000), maxAttempts: 1 });
    const a = (await claimNextJob(db, t0))!;
    const b = (await claimNextJob(db, t0))!;

    // Locks are fresh: nothing to recover yet.
    expect(await recoverStaleJobs(db, after(5 * 60_000), 15 * 60_000)).toBe(0);

    const later = after(16 * 60_000);
    expect(await recoverStaleJobs(db, later, 15 * 60_000)).toBe(2);
    expect(await row(a.id)).toMatchObject({ status: "pending", lockedAt: null });
    expect(await row(b.id)).toMatchObject({ status: "failed" });
    expect(await claimNextJob(db, later)).toMatchObject({ id: a.id, attempts: 2 });
  });

  describe("runQueue", () => {
    it("drains the queue, including jobs enqueued by handlers", async () => {
      await enqueueJob(db, { type: "discover", runAfter: after(-1000) });
      const seen: string[] = [];

      const summary = await runQueue(
        db,
        {
          discover: async (_job, ctx) => {
            seen.push("discover");
            await enqueueJob(ctx.db, { type: "predict", runAfter: t0 });
          },
          predict: async () => {
            seen.push("predict");
          },
        },
        { now: () => t0 },
      );

      expect(seen).toEqual(["discover", "predict"]);
      expect(summary).toMatchObject({ processed: 2, succeeded: 2, retried: 0, failed: 0 });
      expect((await db.select().from(jobs)).every((j) => j.status === "done")).toBe(true);
    });

    it("keeps going after a failing job and schedules its retry", async () => {
      await enqueueJob(db, { type: "predict", runAfter: after(-2000) });
      await enqueueJob(db, { type: "generate", runAfter: after(-1000) });

      const summary = await runQueue(
        db,
        {
          predict: async () => {
            throw new Error("model missing");
          },
          generate: async () => {},
        },
        { now: () => t0 },
      );

      expect(summary).toMatchObject({ processed: 2, succeeded: 1, retried: 1, failed: 0 });
      const [predict] = await db.select().from(jobs).where(eq(jobs.type, "predict"));
      expect(predict).toMatchObject({ status: "pending", lastError: "model missing" });
    });

    it("leaves jobs without a handler pending", async () => {
      await enqueueJob(db, { type: "generate", runAfter: after(-1000) });
      await enqueueJob(db, { type: "predict", runAfter: after(-1000) });
      const summary = await runQueue(db, { predict: async () => {} }, { now: () => t0 });
      expect(summary).toMatchObject({ processed: 1, succeeded: 1 });
      const [generate] = await db.select().from(jobs).where(eq(jobs.type, "generate"));
      expect(generate).toMatchObject({ status: "pending", attempts: 0 });
    });

    it("recovers stale jobs before draining", async () => {
      await enqueueJob(db, { type: "predict", runAfter: after(-1000) });
      await claimNextJob(db, t0);
      const ran: number[] = [];
      const summary = await runQueue(db, { predict: async (job) => void ran.push(job.attempts) }, {
        now: () => after(20 * 60_000),
        staleLockMs: 15 * 60_000,
      });
      expect(summary.recovered).toBe(1);
      expect(ran).toEqual([2]);
    });
  });

  it("prunes old finished jobs only", async () => {
    await enqueueJob(db, { type: "discover", runAfter: after(-1000) });
    await enqueueJob(db, { type: "predict", runAfter: after(-1000) });
    await runQueue(db, { discover: async () => {} }, { now: () => t0 });
    const [done] = await db.select().from(jobs).where(eq(jobs.status, "done"));
    await db.update(jobs).set({ updatedAt: after(-40 * 24 * 60 * 60_000) }).where(eq(jobs.id, done.id));

    expect(await pruneJobs(db, t0, 30)).toBe(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });
});
