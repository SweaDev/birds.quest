import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, trips } from "@/db/schema";
import { buildScenarios, walk, type SeedPoint } from "../../scripts/seed-data";
import { getTestDb, hasTestDb, resetTestDb } from "@/test/db";
import { detectTrips, discoverTrips, splitIntoSegments } from "./trips";
import type { Position, PositionSource } from "./traccar";

const MIN = 60_000;
const options = { idleThresholdMinutes: 10, minTripMinutes: 10 };
const start = new Date("2026-06-01T08:00:00Z");

const toPositions = (points: SeedPoint[], motion: boolean | null = true): Position[] =>
  points.map((p) => ({ fixTime: p.fixTime, lat: p.lat, lon: p.lon, speed: p.speed, motion }));

const at = (minutes: number, motion: boolean | null = true, speed = motion === false ? 0 : 2): Position => ({
  fixTime: new Date(start.getTime() + minutes * MIN),
  lat: 52.5,
  lon: 13.4,
  speed,
  motion,
});

// Long after everything below has ended.
const later = new Date(start.getTime() + 24 * 60 * MIN);

describe("detectTrips", () => {
  it("ignores a 9 minute trip", () => {
    const result = detectTrips(1, toPositions(walk(start, 9, 1)), options, later);
    expect(result.trips).toHaveLength(0);
    expect(result.ignoredShort).toBe(1);
  });

  it("accepts an 11 minute trip", () => {
    const result = detectTrips(1, toPositions(walk(start, 11, 1)), options, later);
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0]).toMatchObject({
      deviceId: 1,
      startedAt: start,
      endedAt: new Date(start.getTime() + 11 * MIN),
      sourceKey: `1:${start.toISOString()}`,
    });
  });

  it("accepts a trip of exactly the minimum length", () => {
    const result = detectTrips(1, toPositions(walk(start, 10, 1)), options, later);
    expect(result.trips).toHaveLength(1);
  });

  it("does not process an ongoing trip", () => {
    const positions = toPositions(walk(start, 30, 1));
    const lastFix = positions.at(-1)!.fixTime;
    const justAfter = new Date(lastFix.getTime() + 2 * MIN);
    const result = detectTrips(1, positions, options, justAfter);
    expect(result.trips).toHaveLength(0);
    expect(result.open).toBe(1);

    const afterThreshold = new Date(lastFix.getTime() + 10 * MIN);
    expect(detectTrips(1, positions, options, afterThreshold).trips).toHaveLength(1);
  });

  it("splits on an idle gap", () => {
    const first = toPositions(walk(start, 15, 1));
    const second = toPositions(walk(new Date(start.getTime() + 15 * MIN + 10 * MIN), 12, 2));
    const result = detectTrips(1, [...first, ...second], options, later);
    expect(result.trips).toHaveLength(2);
  });

  it("keeps a short gap inside one trip", () => {
    const first = toPositions(walk(start, 8, 1));
    const second = toPositions(walk(new Date(start.getTime() + 8 * MIN + 9 * MIN), 8, 2));
    const result = detectTrips(1, [...first, ...second], options, later);
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].endedAt.getTime() - result.trips[0].startedAt.getTime()).toBe(25 * MIN);
  });

  it("splits when the device stands still for the idle threshold", () => {
    const moving1 = toPositions(walk(start, 12, 1));
    const standing = Array.from({ length: 13 }, (_, i) => at(12 + i, false));
    const moving2 = toPositions(walk(new Date(start.getTime() + 26 * MIN), 12, 2));
    const result = detectTrips(1, [...moving1, ...standing, ...moving2], options, later);
    expect(result.trips).toHaveLength(2);
    // The standing time belongs to neither trip.
    expect(result.trips[0].endedAt.getTime()).toBe(start.getTime() + 12 * MIN);
    expect(result.trips[1].startedAt.getTime()).toBe(start.getTime() + 26 * MIN);
  });

  it("keeps a short stop inside the trip", () => {
    const moving1 = toPositions(walk(start, 6, 1));
    const standing = Array.from({ length: 4 }, (_, i) => at(6 + i, false));
    const moving2 = toPositions(walk(new Date(start.getTime() + 10 * MIN), 6, 2));
    const result = detectTrips(1, [...moving1, ...standing, ...moving2], options, later);
    expect(result.trips).toHaveLength(1);
  });

  it("closes a trip when the device keeps reporting while standing still", () => {
    const moving = toPositions(walk(start, 15, 1));
    const standing = Array.from({ length: 11 }, (_, i) => at(15 + i, false));
    // Positions are still arriving, so only the standing rule can end the trip.
    const now = new Date(start.getTime() + 26 * MIN);
    const result = detectTrips(1, [...moving, ...standing], options, now);
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].endedAt.getTime()).toBe(start.getTime() + 15 * MIN);
  });

  it("falls back to speed when there is no motion attribute", () => {
    const moving = Array.from({ length: 13 }, (_, i) => at(i, null, 2));
    const standing = Array.from({ length: 12 }, (_, i) => at(13 + i, null, 0));
    const positions = [...moving, ...standing];
    const segments = splitIntoSegments(positions, 10 * MIN, new Date(start.getTime() + 25 * MIN));
    expect(segments).toHaveLength(1);
    expect(segments[0].closed).toBe(true);
    expect(segments[0].positions).toHaveLength(13);
  });

  it("computes the centroid", () => {
    const positions = [at(0), at(6), { ...at(12), lat: 53.5, lon: 14.4 }];
    const result = detectTrips(1, positions, options, later);
    expect(result.trips[0].centroidLat).toBeCloseTo((52.5 + 52.5 + 53.5) / 3);
    expect(result.trips[0].centroidLon).toBeCloseTo((13.4 + 13.4 + 14.4) / 3);
  });
});

function memorySource(data: Record<number, Position[]>): PositionSource {
  return {
    async listDeviceIds() {
      return Object.keys(data).map(Number);
    },
    async positions(deviceId, query = {}) {
      return (data[deviceId] ?? []).filter(
        (p) =>
          (!query.after || p.fixTime > query.after) && (!query.until || p.fixTime <= query.until),
      );
    },
  };
}

describe.skipIf(!hasTestDb)("discoverTrips (database)", () => {
  const db = getTestDb();
  beforeEach(() => resetTestDb(db));

  const now = new Date("2026-06-02T12:00:00Z");

  it("stores ended trips of at least 10 minutes, ignoring short and ongoing ones", async () => {
    const source = memorySource({ 1: buildScenarios(now).flatMap((s) => toPositions(s.points)) });
    const result = await discoverTrips(db, source, options, now);

    expect(result).toMatchObject({ created: 2, ignoredShort: 1, open: 1 });
    const rows = await db.select().from(trips);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "discovered")).toBe(true);
  });

  it("is idempotent and enqueues one predict job per trip", async () => {
    const source = memorySource({ 1: buildScenarios(now).flatMap((s) => toPositions(s.points)) });
    await discoverTrips(db, source, options, now);
    const second = await discoverTrips(db, source, options, now);

    expect(second.created).toBe(0);
    expect(await db.select().from(trips)).toHaveLength(2);
    const queued = await db.select().from(jobs).where(eq(jobs.type, "predict"));
    expect(queued).toHaveLength(2);
    expect(queued.map((j) => j.payload).every((p) => typeof p.tripId === "number")).toBe(true);
  });

  it("enqueues a missing predict job for a trip that was stored without one", async () => {
    const source = memorySource({ 1: toPositions(walk(new Date("2026-06-01T08:00:00Z"), 20, 1)) });
    await discoverTrips(db, source, options, now);
    await db.delete(jobs);

    const again = await discoverTrips(db, source, options, now);
    expect(again.created).toBe(0);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("does not turn an ongoing trip into a trip until it ends", async () => {
    const positions = toPositions(walk(new Date("2026-06-02T11:30:00Z"), 25, 1));
    const source = memorySource({ 1: positions });

    const during = new Date("2026-06-02T11:56:00Z");
    expect((await discoverTrips(db, source, options, during)).created).toBe(0);
    expect(await db.select().from(trips)).toHaveLength(0);

    const after = new Date("2026-06-02T12:30:00Z");
    expect((await discoverTrips(db, source, options, after)).created).toBe(1);
  });

  it("keeps devices separate", async () => {
    const source = memorySource({
      1: toPositions(walk(start, 20, 1)),
      2: toPositions(walk(start, 20, 2)),
    });
    const result = await discoverTrips(db, source, options, later);
    expect(result.created).toBe(2);
  });
});
