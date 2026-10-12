import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { predictions, trips, type Job } from "@/db/schema";
import { isBirdCode, type GeoInput, type Species } from "./geomodel";
import { enqueueJob } from "./queue";
import type { PositionSource } from "./traccar";
import { sampleRoute } from "./route";

export { MAX_SAMPLE_POINTS, SAMPLE_SPACING_METERS, haversineMeters, sampleRoute } from "./route";

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

  // Imported trips carry their own route; Traccar trips read it from Traccar.
  const positions: { lat: number; lon: number }[] = trip.route
    ? trip.route.map(([lat, lon]) => ({ lat, lon }))
    : await deps.source.positions(trip.deviceId, {
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
