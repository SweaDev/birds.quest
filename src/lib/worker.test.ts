import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, trips } from "@/db/schema";
import { getTestDb, hasTestDb, resetTestDb } from "@/test/db";
import { walk } from "../../scripts/seed-data";
import type { PositionSource } from "./traccar";
import { runWorkerOnce } from "./worker";

describe.skipIf(!hasTestDb)("runWorkerOnce (database)", () => {
  const db = getTestDb();
  beforeEach(() => resetTestDb(db));

  const now = new Date("2026-06-02T12:00:00Z");
  const positions = walk(new Date("2026-06-01T08:00:00Z"), 20, 1).map((p) => ({
    fixTime: p.fixTime,
    lat: p.lat,
    lon: p.lon,
    speed: p.speed,
    motion: true,
  }));
  const source: PositionSource = {
    listDeviceIds: async () => [1],
    positions: async (_id, q = {}) => positions.filter((p) => !q.after || p.fixTime > q.after),
  };
  const deps = { db, source, now: () => now, log: () => {}, config: { idleThresholdMinutes: 10, minTripMinutes: 10 } };

  it("discovers trips, queues predict jobs and exits when the queue is drained", async () => {
    const summary = await runWorkerOnce(deps);
    expect(summary).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    expect(await db.select().from(trips)).toHaveLength(1);
    const [predict] = await db.select().from(jobs).where(eq(jobs.type, "predict"));
    // No predict handler is registered yet, so the job waits for it.
    expect(predict.status).toBe("pending");
  });

  it("can run repeatedly without duplicating trips or jobs", async () => {
    await runWorkerOnce(deps);
    await runWorkerOnce(deps);
    expect(await db.select().from(trips)).toHaveLength(1);
    expect(await db.select().from(jobs).where(eq(jobs.type, "predict"))).toHaveLength(1);
  });
});
