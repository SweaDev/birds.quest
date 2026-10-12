import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, posts, trips } from "@/db/schema";
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
  const deps = {
    db,
    source,
    now: () => now,
    log: () => {},
    config: {
      idleThresholdMinutes: 10,
      minTripMinutes: 10,
      predictionThreshold: 0.15,
      predictionTopK: 20,
      wikipediaUserAgent: "test",
      llm: { provider: "ollama" as const, baseUrl: "http://unused", model: "unused" },
    },
    wiki: { lookupSpecies: async () => null },
    llm: { complete: async () => "# A title\n\nAn intro.\n\n## Great Tit\nA lively bird.\n\n## Final thoughts\nBye." },
    model: async () => ({
      species: [{ code: "gretit1", scientificName: "Parus major", commonName: "Great Tit" }],
      predict: async (inputs: unknown[]) => inputs.map(() => new Float32Array([0.9])),
    }),
  };

  it("runs the whole pipeline to a draft post, then exits when the queue is drained", async () => {
    const summary = await runWorkerOnce(deps);
    expect(summary).toMatchObject({ processed: 4, succeeded: 4, failed: 0 });
    expect(await db.select().from(trips)).toMatchObject([{ status: "generated" }]);
    const states = await db.select().from(jobs);
    expect(states.every((j) => j.status === "done")).toBe(true);
    expect(await db.select().from(posts)).toMatchObject([{ status: "draft", title: "A title" }]);
  });

  it("can run repeatedly without duplicating trips or jobs", async () => {
    await runWorkerOnce(deps);
    await runWorkerOnce(deps);
    expect(await db.select().from(trips)).toHaveLength(1);
    expect(await db.select().from(jobs).where(eq(jobs.type, "predict"))).toHaveLength(1);
  });
});
