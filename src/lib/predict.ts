import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { predictions, trips, type Job } from "@/db/schema";
import { isBirdCode, type GeoInput, type Species } from "./geomodel";
import { enqueueJob } from "./queue";
import type { Position, PositionSource } from "./traccar";

// Route points are sampled roughly this far apart, and never more than MAX_POINTS in total.
export const SAMPLE_SPACING_METERS = 300;
export const MAX_SAMPLE_POINTS = 120;

/** Minimal model surface needed here, so tests can use a fake. */
export interface SpeciesModel {
  readonly species: readonly Species[];
  predict(inputs: GeoInput[]): Promise<Float32Array[]>;
}

/**
 * BirdNET week number (1-48, four per month) of a date, in UTC:
 * days 1-7 are week 1 of the month, 8-14 week 2, 15-21 week 3, the rest week 4.
 */
export function weekOfDate(date: Date): number {
  const day = date.getUTCDate();
  const inMonth = day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4;
  return date.getUTCMonth() * 4 + inMonth;
}

export function midTime(start: Date, end: Date): Date {
  return new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
}

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Keeps the first point, then every point at least `spacing` metres from the last kept one, plus the end point. */
export function sampleRoute<T extends { lat: number; lon: number }>(
  points: T[],
  spacing = SAMPLE_SPACING_METERS,
  maxPoints = MAX_SAMPLE_POINTS,
): T[] {
  if (points.length === 0) return [];
  const kept = [points[0]];
  for (const point of points.slice(1)) {
    if (haversineMeters(kept.at(-1)!, point) >= spacing) kept.push(point);
  }
  const last = points.at(-1)!;
  if (kept.at(-1) !== last && haversineMeters(kept.at(-1)!, last) > 0) kept.push(last);

  if (kept.length <= maxPoints) return kept;
  // Too long a route: thin out evenly, keeping both ends.
  return Array.from({ length: maxPoints }, (_, i) => kept[Math.round((i * (kept.length - 1)) / (maxPoints - 1))]);
}

export type SpeciesScore = Species & { probability: number };

export type SelectOptions = { threshold: number; topK: number };

/**
 * Combines per-point probabilities into one score per bird species (the maximum
 * over the route, i.e. "could be seen anywhere along it"), keeps those at or
 * above `threshold` and returns the `topK` most likely.
 */
export function aggregateMax(rows: Float32Array[], species: readonly Species[], options: SelectOptions): SpeciesScore[] {
  const result: SpeciesScore[] = [];
  species.forEach((s, i) => {
    if (!isBirdCode(s.code)) return;
    let best = 0;
    for (const row of rows) if (row[i] > best) best = row[i];
    if (best >= options.threshold) result.push({ ...s, probability: best });
  });
  return result.sort((a, b) => b.probability - a.probability || a.code.localeCompare(b.code)).slice(0, options.topK);
}

export type PredictDeps = {
  source: PositionSource;
  model: () => Promise<SpeciesModel>;
  options: SelectOptions;
  now?: Date;
};

/** `predict` job: stores the likely species for a trip, then queues enrichment. */
export async function predictTrip(db: Db, tripId: number, deps: PredictDeps): Promise<SpeciesScore[]> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) throw new Error(`Trip ${tripId} not found`);

  const positions: Position[] = await deps.source.positions(trip.deviceId, {
    after: new Date(trip.startedAt.getTime() - 1),
    until: trip.endedAt,
  });
  // Fall back to the stored centroid if Traccar no longer has the positions.
  const route = positions.length > 0 ? sampleRoute(positions) : [{ lat: trip.centroidLat, lon: trip.centroidLon }];
  const week = weekOfDate(midTime(trip.startedAt, trip.endedAt));

  const model = await deps.model();
  const rows = await model.predict(route.map((p) => ({ lat: p.lat, lon: p.lon, week })));
  const selected = aggregateMax(rows, model.species, deps.options);

  await db.transaction(async (tx) => {
    await tx.delete(predictions).where(eq(predictions.tripId, tripId));
    if (selected.length > 0) {
      await tx.insert(predictions).values(
        selected.map((s) => ({
          tripId,
          speciesCode: s.code,
          scientificName: s.scientificName,
          commonName: s.commonName,
          probability: s.probability,
        })),
      );
    }
    await tx
      .update(trips)
      .set({ status: "predicted" })
      .where(and(eq(trips.id, tripId), eq(trips.status, "discovered")));
  });

  await enqueueJob(db, {
    type: "enrich",
    payload: { tripId },
    dedupeKey: `enrich:${tripId}`,
    runAfter: deps.now ?? new Date(),
  });
  return selected;
}

export function tripIdFromJob(job: Pick<Job, "payload" | "type">): number {
  const tripId = job.payload.tripId;
  if (typeof tripId !== "number" || !Number.isInteger(tripId)) {
    throw new Error(`${job.type} job needs an integer tripId in its payload`);
  }
  return tripId;
}

export async function listPredictions(db: Db, tripId: number) {
  return db.select().from(predictions).where(eq(predictions.tripId, tripId)).orderBy(desc(predictions.probability), predictions.speciesCode);
}
