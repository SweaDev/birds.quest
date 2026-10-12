import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { trips } from "@/db/schema";
import type { ParsedKml } from "./kml";
import { sampleRoute } from "./route";
import { enqueueJob } from "./queue";

/** Imported trips are not tied to a Traccar device. Traccar ids start at 1. */
export const IMPORT_DEVICE_ID = 0;

const MAX_TRIP_MS = 7 * 24 * 60 * 60_000;

/** `datetime-local` values (`2026-10-10T18:00`) are read as UTC, like every other time in the app. */
export function parseLocalInput(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(value.trim());
  const date = m ? new Date(`${m[1]}T${m[2]}:${m[3] ?? "00"}Z`) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new Error("That date and time is not valid.");
  return date;
}

export type ImportResult = { tripId: number; created: boolean };

/**
 * Stores a trip from an uploaded route and queues its `predict` job, which
 * continues like any Traccar trip (enrich, generate). Importing the same route
 * for the same period again returns the existing trip. Times typed in the form
 * win over those found in the file; one of the two must provide both.
 */
export async function importTrip(
  db: Db,
  parsed: ParsedKml,
  override: { start?: Date; end?: Date } = {},
  now: Date = new Date(),
): Promise<ImportResult> {
  const startedAt = override.start ?? parsed.start;
  const endedAt = override.end ?? parsed.end;
  if (!startedAt || !endedAt) {
    throw new Error("The file has no times. Enter when the trip started and ended.");
  }
  if (endedAt.getTime() <= startedAt.getTime()) throw new Error("The end must be after the start.");
  if (endedAt.getTime() - startedAt.getTime() > MAX_TRIP_MS) throw new Error("A trip can be 7 days long at most.");

  const { points } = parsed;
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lon = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  const route = sampleRoute(points).map((p): [number, number] => [p.lat, p.lon]);

  const digest = createHash("sha256")
    .update(JSON.stringify([route, startedAt.toISOString(), endedAt.toISOString()]))
    .digest("hex")
    .slice(0, 32);
  const sourceKey = `import:${digest}`;

  const [known] = await db.select({ id: trips.id }).from(trips).where(eq(trips.sourceKey, sourceKey));
  if (known) return { tripId: known.id, created: false };

  const [inserted] = await db.insert(trips).values({
    sourceKey,
    deviceId: IMPORT_DEVICE_ID,
    startedAt,
    endedAt,
    positionCount: points.length,
    centroidLat: lat,
    centroidLon: lon,
    route,
  });
  const tripId = inserted.insertId;
  await enqueueJob(db, { type: "predict", payload: { tripId }, dedupeKey: `predict:${tripId}`, runAfter: now });
  return { tripId, created: true };
}
