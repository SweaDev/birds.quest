import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, predictions, trips } from "@/db/schema";
import { getTestDb, hasTestDb, resetTestDb } from "@/test/db";
import { GeoModel, defaultModelPaths, type Species } from "./geomodel";
import {
  aggregateMax,
  haversineMeters,
  listPredictions,
  midTime,
  predictTrip,
  sampleRoute,
  weekOfDate,
  type SpeciesModel,
} from "./predict";
import type { Position, PositionSource } from "./traccar";

describe("weekOfDate", () => {
  it.each([
    ["2026-01-01", 1],
    ["2026-01-07", 1],
    ["2026-01-08", 2],
    ["2026-01-15", 3],
    ["2026-01-22", 4],
    ["2026-01-31", 4],
    ["2026-02-01", 5],
    ["2026-05-31", 20],
    ["2026-06-01", 21],
    ["2026-06-10", 22],
    ["2026-12-31", 48],
  ])("%s is week %i", (date, week) => {
    expect(weekOfDate(new Date(`${date}T12:00:00Z`))).toBe(week);
  });

  it("uses UTC, so the result does not depend on the server time zone", () => {
    expect(weekOfDate(new Date("2026-01-07T23:59:59Z"))).toBe(1);
    expect(weekOfDate(new Date("2026-01-08T00:00:00Z"))).toBe(2);
  });

  it("uses the trip's mid-time", () => {
    const mid = midTime(new Date("2026-01-07T22:00:00Z"), new Date("2026-01-08T04:00:00Z"));
    expect(mid.toISOString()).toBe("2026-01-08T01:00:00.000Z");
    expect(weekOfDate(mid)).toBe(2);
  });
});

describe("sampleRoute", () => {
  // ~11 m per 0.0001 degrees of latitude
  const line = (n: number, step = 0.0001) => Array.from({ length: n }, (_, i) => ({ lat: 52 + i * step, lon: 13 }));

  it("measures distance in metres", () => {
    expect(haversineMeters({ lat: 52, lon: 13 }, { lat: 52.001, lon: 13 })).toBeGreaterThan(110);
    expect(haversineMeters({ lat: 52, lon: 13 }, { lat: 52.001, lon: 13 })).toBeLessThan(112);
  });

  it("keeps points roughly every 300 m and always the first and last", () => {
    const points = line(300); // about 3.3 km
    const sampled = sampleRoute(points);
    expect(sampled[0]).toBe(points[0]);
    expect(sampled.at(-1)).toBe(points.at(-1));
    expect(sampled.length).toBeGreaterThan(8);
    expect(sampled.length).toBeLessThan(15);
    for (let i = 1; i < sampled.length - 1; i++) {
      expect(haversineMeters(sampled[i - 1], sampled[i])).toBeGreaterThanOrEqual(300);
    }
  });

  it("returns a single point for a stationary track", () => {
    expect(sampleRoute(Array.from({ length: 20 }, () => ({ lat: 52, lon: 13 })))).toHaveLength(1);
  });

  it("handles empty input and caps very long routes", () => {
    expect(sampleRoute([])).toEqual([]);
    const sampled = sampleRoute(line(5000, 0.001), 300, 50);
    expect(sampled).toHaveLength(50);
  });
});

describe("aggregateMax", () => {
  const species: Species[] = [
    { code: "bird_a", scientificName: "Avis a", commonName: "Bird A" },
    { code: "bird_b", scientificName: "Avis b", commonName: "Bird B" },
    { code: "12345", scientificName: "Insecta x", commonName: "Some insect" },
    { code: "bird_c", scientificName: "Avis c", commonName: "Bird C" },
  ];
  const rows = [new Float32Array([0.2, 0.9, 0.99, 0.1]), new Float32Array([0.6, 0.3, 0.99, 0.12])];

  it("takes the maximum over points, drops non-birds, applies the threshold and sorts", () => {
    const result = aggregateMax(rows, species, { threshold: 0.15, topK: 10 });
    expect(result.map((s) => [s.code, Number(s.probability.toFixed(2))])).toEqual([
      ["bird_b", 0.9],
      ["bird_a", 0.6],
    ]);
  });

  it("limits to the top K", () => {
    expect(aggregateMax(rows, species, { threshold: 0, topK: 1 }).map((s) => s.code)).toEqual(["bird_b"]);
  });

  it("keeps a species exactly at the threshold", () => {
    const result = aggregateMax([new Float32Array([0.5, 0, 0, 0])], species, { threshold: 0.5, topK: 5 });
    expect(result.map((s) => s.code)).toEqual(["bird_a"]);
  });
});

const paths = defaultModelPaths();
const hasModel = existsSync(paths.modelPath) && existsSync(paths.labelsPath);

describe.skipIf(!hasModel)("GeoModel sample check (needs `pnpm models:download`)", () => {
  it("predicts Common Blackbird and Great Tit near the top for Berlin in week 22", async () => {
    const model = await GeoModel.load(paths);
    const result = await model.predictAt({ lat: 52.5, lon: 13.4, week: 22 }, { topK: 25 });
    const names = result.map((s) => s.scientificName);
    expect(names).toContain("Turdus merula"); // Eurasian/Common Blackbird
    expect(names).toContain("Parus major"); // Great Tit
    expect(result[0].probability).toBeGreaterThan(0.9);
  });
});

describe.skipIf(!hasTestDb)("predictTrip (database)", () => {
  const db = getTestDb();
  beforeEach(() => resetTestDb(db));

  const species: Species[] = [
    { code: "bird_a", scientificName: "Avis a", commonName: "Bird A" },
    { code: "bird_b", scientificName: "Avis b", commonName: "Bird B" },
    { code: "999", scientificName: "Insecta x", commonName: "Insect" },
  ];
  const seenInputs: { lat: number; lon: number; week: number }[] = [];
  const model: SpeciesModel = {
    species,
    predict: async (inputs) => {
      seenInputs.push(...inputs);
      return inputs.map((_, i) => new Float32Array([0.4 + i * 0.01, 0.05, 0.99]));
    },
  };
  const positions: Position[] = Array.from({ length: 40 }, (_, i) => ({
    fixTime: new Date(Date.UTC(2026, 5, 10, 8, i)),
    lat: 52 + i * 0.0005,
    lon: 13,
    speed: 2,
    motion: true,
  }));
  const source: PositionSource = {
    listDeviceIds: async () => [1],
    positions: async (_id, q = {}) =>
      positions.filter((p) => (!q.after || p.fixTime > q.after) && (!q.until || p.fixTime <= q.until)),
  };
  const deps = { source, model: async () => model, options: { threshold: 0.15, topK: 20 } };

  async function insertTrip() {
    await db.insert(trips).values({
      sourceKey: "1:test",
      deviceId: 1,
      startedAt: positions[0].fixTime,
      endedAt: positions.at(-1)!.fixTime,
      positionCount: positions.length,
      centroidLat: 52.01,
      centroidLon: 13,
    });
    return (await db.select().from(trips))[0].id;
  }

  beforeEach(() => {
    seenInputs.length = 0;
  });

  it("samples the route, uses the mid-time week, stores predictions and queues enrichment", async () => {
    const tripId = await insertTrip();
    const result = await predictTrip(db, tripId, deps);

    expect(seenInputs.length).toBeGreaterThan(1);
    expect(seenInputs.length).toBeLessThan(positions.length);
    expect(new Set(seenInputs.map((i) => i.week))).toEqual(new Set([22]));

    // Only bird_a passes the 0.15 threshold; the insect is dropped even at 0.99.
    expect(result.map((s) => s.code)).toEqual(["bird_a"]);
    const stored = await listPredictions(db, tripId);
    expect(stored).toMatchObject([{ speciesCode: "bird_a", scientificName: "Avis a", commonName: "Bird A" }]);
    expect(stored[0].probability).toBeGreaterThan(0.4);

    expect((await db.select().from(trips))[0].status).toBe("predicted");
    const [enrich] = await db.select().from(jobs).where(eq(jobs.type, "enrich"));
    expect(enrich).toMatchObject({ status: "pending", payload: { tripId }, dedupeKey: `enrich:${tripId}` });
  });

  it("replaces earlier predictions when run again", async () => {
    const tripId = await insertTrip();
    await predictTrip(db, tripId, deps);
    await predictTrip(db, tripId, { ...deps, options: { threshold: 0, topK: 20 } });

    expect(await db.select().from(predictions)).toHaveLength(2);
    expect(await db.select().from(jobs).where(eq(jobs.type, "enrich"))).toHaveLength(1);
  });

  it("falls back to the trip centroid when Traccar has no positions", async () => {
    const tripId = await insertTrip();
    await predictTrip(db, tripId, { ...deps, source: { ...source, positions: async () => [] } });
    expect(seenInputs).toEqual([{ lat: 52.01, lon: 13, week: 22 }]);
  });

  it("fails for an unknown trip", async () => {
    await expect(predictTrip(db, 424242, deps)).rejects.toThrow(/not found/);
  });
});
