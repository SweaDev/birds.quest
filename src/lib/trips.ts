import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { trips } from "@/db/schema";
import { enqueueJob } from "./queue";
import type { Position, PositionSource } from "./traccar";

const MINUTE = 60_000;
// Traccar speeds are in knots; below this a position counts as standing still
// when the device gives no explicit `motion` attribute.
const MOVING_SPEED_KNOTS = 0.5;

export type TripOptions = {
  idleThresholdMinutes: number;
  minTripMinutes: number;
};

export type TripCandidate = {
  deviceId: number;
  sourceKey: string;
  startedAt: Date;
  endedAt: Date;
  positionCount: number;
  centroidLat: number;
  centroidLon: number;
};

export type Segment = { positions: Position[]; closed: boolean };

export function isMoving(position: Position): boolean {
  if (position.motion !== null) return position.motion;
  if (position.speed !== null) return position.speed >= MOVING_SPEED_KNOTS;
  return true;
}

/**
 * Splits one device's time-ordered positions into segments.
 * A segment ends when
 *  - two consecutive positions are at least `idleMs` apart (idle gap), or
 *  - the device stood still for at least `idleMs` (motion).
 * Stationary positions at the edges of a segment are dropped, so a trip starts
 * and ends at the first and last moving position. The last segment is `closed`
 * only when it was ended by one of the rules above, or when the newest position
 * is at least `idleMs` old at `now`.
 */
export function splitIntoSegments(positions: Position[], idleMs: number, now: Date): Segment[] {
  const segments: Segment[] = [];
  let current: Position[] = [];
  // Stationary positions since the last moving one, not yet part of `current`.
  let still: Position[] = [];

  const closeCurrent = () => {
    if (current.length > 0) segments.push({ positions: current, closed: true });
    current = [];
    still = [];
  };

  for (const position of positions) {
    const previous = still.at(-1) ?? current.at(-1);
    if (previous && position.fixTime.getTime() - previous.fixTime.getTime() >= idleMs) {
      closeCurrent();
    }

    if (isMoving(position)) {
      // A pause shorter than the idle threshold is part of the trip.
      current.push(...still, position);
      still = [];
    } else if (current.length > 0) {
      still.push(position);
      const stoppedFor = position.fixTime.getTime() - current.at(-1)!.fixTime.getTime();
      if (stoppedFor >= idleMs) closeCurrent();
    }
  }

  if (current.length > 0) {
    const newest = positions.at(-1)!;
    const closed = now.getTime() - newest.fixTime.getTime() >= idleMs;
    segments.push({ positions: current, closed });
  }
  return segments;
}

export function toCandidate(deviceId: number, positions: Position[]): TripCandidate {
  const startedAt = positions[0].fixTime;
  const endedAt = positions.at(-1)!.fixTime;
  const lat = positions.reduce((sum, p) => sum + p.lat, 0) / positions.length;
  const lon = positions.reduce((sum, p) => sum + p.lon, 0) / positions.length;
  return {
    deviceId,
    sourceKey: `${deviceId}:${startedAt.toISOString()}`,
    startedAt,
    endedAt,
    positionCount: positions.length,
    centroidLat: lat,
    centroidLon: lon,
  };
}

/** Pure trip detection: only ended trips of at least `minTripMinutes` are returned. */
export function detectTrips(
  deviceId: number,
  positions: Position[],
  options: TripOptions,
  now: Date,
): { trips: TripCandidate[]; ignoredShort: number; open: number } {
  const idleMs = options.idleThresholdMinutes * MINUTE;
  const minMs = options.minTripMinutes * MINUTE;
  const result: TripCandidate[] = [];
  let ignoredShort = 0;
  let open = 0;
  for (const segment of splitIntoSegments(positions, idleMs, now)) {
    if (!segment.closed) {
      open++;
      continue;
    }
    const candidate = toCandidate(deviceId, segment.positions);
    if (segment.positions.length < 2 || candidate.endedAt.getTime() - candidate.startedAt.getTime() < minMs) {
      ignoredShort++;
      continue;
    }
    result.push(candidate);
  }
  return { trips: result, ignoredShort, open };
}

export type DiscoverResult = { created: number; existing: number; ignoredShort: number; open: number };

/**
 * Finds ended trips in Traccar positions and stores them. Safe to re-run: trips
 * are keyed by device and start time, and each trip gets exactly one `predict` job.
 */
export async function discoverTrips(
  db: Db,
  source: PositionSource,
  options: TripOptions,
  now: Date = new Date(),
): Promise<DiscoverResult> {
  const summary: DiscoverResult = { created: 0, existing: 0, ignoredShort: 0, open: 0 };

  for (const deviceId of await source.listDeviceIds()) {
    const [last] = await db
      .select({ endedAt: trips.endedAt })
      .from(trips)
      .where(eq(trips.deviceId, deviceId))
      .orderBy(desc(trips.endedAt))
      .limit(1);

    const positions = await source.positions(deviceId, { after: last?.endedAt });
    const found = detectTrips(deviceId, positions, options, now);
    summary.ignoredShort += found.ignoredShort;
    summary.open += found.open;

    for (const trip of found.trips) {
      const [known] = await db.select({ id: trips.id }).from(trips).where(eq(trips.sourceKey, trip.sourceKey));
      if (known) {
        summary.existing++;
        continue;
      }
      await db.insert(trips).values(trip).onDuplicateKeyUpdate({ set: { id: sql`id` } });
      summary.created++;
    }
  }

  // Also covers a crash between inserting a trip and enqueueing its job.
  const waiting = await db.select({ id: trips.id }).from(trips).where(eq(trips.status, "discovered"));
  for (const { id } of waiting) {
    await enqueueJob(db, { type: "predict", payload: { tripId: id }, dedupeKey: `predict:${id}`, runAfter: now });
  }
  return summary;
}
