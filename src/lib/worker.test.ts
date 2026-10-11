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
  const deps = { db, source, now: () => now, log: () => {}, config: { idleThresholdMinutes: 10, minTripMinutes: 10, predictionThreshold: 0.15, predictionTopK: 20, wikipediaUserAgent: "test" }, wiki: { lookupSpecies: async () => null }, model: async () => ({ species: [], predict: async () => [] }) };

  it("discovers trips, predicts and enriches them, then exits when the queue is drained", async () => {
    const summary = await runWorkerOnce(deps);
    expect(summary).toMatchObject({ processed: 3, succeeded: 3, failed: 0 });
    expect(await db.select().from(trips)).toMatchObject([{ status: "predicted" }]);
    const [predict] = await db.select().from(jobs).where(eq(jobs.type, "predict"));
    expect(predict.status).toBe("done");
    const [enrich] = await db.select().from(jobs).where(eq(jobs.type, "enrich"));
    expect(enrich.status).toBe("done");
    // No generate handler is registered yet, so that job waits for it.
    const [generate] = await db.select().from(jobs).where(eq(jobs.type, "generate"));
    expect(generate.status).toBe("pending");
  });

  it("can run repeatedly without duplicating trips or jobs", async () => {
    await runWorkerOnce(deps);
    await runWorkerOnce(deps);
    expect(await db.select().from(trips)).toHaveLength(1);
    expect(await db.select().from(jobs).where(eq(jobs.type, "predict"))).toHaveLength(1);
  });
});
