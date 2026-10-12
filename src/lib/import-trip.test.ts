import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, trips } from "@/db/schema";
import { getTestDb, hasTestDb, resetTestDb } from "@/test/db";
import { importTrip, parseLocalInput } from "./import-trip";
import type { ParsedKml } from "./kml";

describe("parseLocalInput", () => {
  it("reads datetime-local values as UTC and treats empty as unset", () => {
    expect(parseLocalInput("2026-10-10T18:00")?.toISOString()).toBe("2026-10-10T18:00:00.000Z");
    expect(parseLocalInput("")).toBeUndefined();
    expect(parseLocalInput(null)).toBeUndefined();
    expect(() => parseLocalInput("yesterday")).toThrow(/not valid/);
  });
});

describe.skipIf(!hasTestDb)("importTrip (database)", () => {
  const db = getTestDb();
  beforeEach(() => resetTestDb(db));

  const parsed: ParsedKml = {
    points: Array.from({ length: 40 }, (_, i) => ({ lat: 23.79 + i * 0.001, lon: 90.37 })),
    start: new Date("2026-10-10T18:00:00Z"),
    end: new Date("2026-10-11T17:59:00Z"),
  };

  it("stores the trip with its route and queues a predict job", async () => {
    const result = await importTrip(db, parsed);
    expect(result.created).toBe(true);

    const [trip] = await db.select().from(trips);
    expect(trip).toMatchObject({ id: result.tripId, deviceId: 0, status: "discovered", positionCount: 40 });
    expect(trip.sourceKey).toMatch(/^import:/);
    expect(trip.route!.length).toBeGreaterThan(1);
    expect(trip.route!.length).toBeLessThan(40);

    const [job] = await db.select().from(jobs).where(eq(jobs.type, "predict"));
    expect(job).toMatchObject({ status: "pending", payload: { tripId: result.tripId } });
  });

  it("is idempotent for the same route and period", async () => {
    const first = await importTrip(db, parsed);
    const second = await importTrip(db, parsed);
    expect(second).toEqual({ tripId: first.tripId, created: false });
    expect(await db.select().from(trips)).toHaveLength(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("lets form times override the file and requires times from one of them", async () => {
    const start = new Date("2026-06-10T08:00:00Z");
    const end = new Date("2026-06-10T09:00:00Z");
    await importTrip(db, parsed, { start, end });
    expect((await db.select().from(trips))[0].startedAt).toEqual(start);

    await expect(importTrip(db, { points: parsed.points })).rejects.toThrow(/no times/);
    await expect(importTrip(db, parsed, { start: end, end: start })).rejects.toThrow(/after the start/);
    await expect(importTrip(db, parsed, { start, end: new Date("2026-07-10T09:00:00Z") })).rejects.toThrow(/7 days/);
  });
});
