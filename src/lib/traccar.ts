import { and, asc, eq, gt, lte } from "drizzle-orm";
import { getTraccarDb, tcDevices, tcPositions, type TraccarDb } from "@/db/traccar";

export type Position = {
  fixTime: Date;
  lat: number;
  lon: number;
  // Knots, as stored by Traccar.
  speed: number | null;
  // Traccar's `motion` attribute, when the device/server provides it.
  motion: boolean | null;
};

export type PositionQuery = {
  /** Only positions strictly after this time. */
  after?: Date;
  /** Only positions up to and including this time. */
  until?: Date;
};

// Seam between trip logic and Traccar's database, so tests can use in-memory data.
export interface PositionSource {
  listDeviceIds(): Promise<number[]>;
  positions(deviceId: number, query?: PositionQuery): Promise<Position[]>;
}

export function parseMotion(attributes: string | null | undefined): boolean | null {
  if (!attributes) return null;
  try {
    const parsed: unknown = JSON.parse(attributes);
    if (parsed && typeof parsed === "object" && "motion" in parsed) {
      const motion = (parsed as { motion: unknown }).motion;
      return typeof motion === "boolean" ? motion : null;
    }
  } catch {
    // Malformed attributes are treated as "unknown".
  }
  return null;
}

export function createTraccarSource(db: TraccarDb = getTraccarDb()): PositionSource {
  return {
    async listDeviceIds() {
      const rows = await db.select({ id: tcDevices.id }).from(tcDevices).orderBy(asc(tcDevices.id));
      return rows.map((row) => row.id);
    },
    async positions(deviceId, query = {}) {
      const conditions = [eq(tcPositions.deviceId, deviceId)];
      if (query.after) conditions.push(gt(tcPositions.fixTime, query.after));
      if (query.until) conditions.push(lte(tcPositions.fixTime, query.until));
      const rows = await db
        .select({
          fixTime: tcPositions.fixTime,
          lat: tcPositions.latitude,
          lon: tcPositions.longitude,
          speed: tcPositions.speed,
          attributes: tcPositions.attributes,
        })
        .from(tcPositions)
        .where(and(...conditions))
        .orderBy(asc(tcPositions.fixTime), asc(tcPositions.id));
      return rows.map((row) => ({
        fixTime: row.fixTime,
        lat: row.lat,
        lon: row.lon,
        speed: row.speed,
        motion: parseMotion(row.attributes),
      }));
    },
  };
}
