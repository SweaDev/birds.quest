import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeAllPools, getDb } from "@/db";
import { getPool } from "@/db/pool";
import { getTraccarDb, tcPositions } from "@/db/traccar";

// These need the local MariaDB from .env (with migrations applied and `pnpm db:seed` run).
const hasDb = Boolean(process.env.DATABASE_URL && process.env.TRACCAR_DATABASE_URL);

afterAll(async () => {
  await closeAllPools();
});

describe.skipIf(!hasDb)("database smoke test", () => {
  it("connects to the app database and finds the migrated tables", async () => {
    const [rows] = await getDb().execute(sql`SHOW TABLES`);
    const tables = (rows as unknown as Record<string, string>[]).map((row) => Object.values(row)[0]);
    expect(tables).toEqual(
      expect.arrayContaining([
        "trips",
        "predictions",
        "species_info",
        "posts",
        "post_species",
        "jobs",
        "admin_sessions",
      ]),
    );
  });

  it("round-trips DATETIME values as UTC", async () => {
    const [rows] = await getPool(process.env.DATABASE_URL!).query(
      "SELECT CAST('2026-01-02 03:04:05.678' AS DATETIME(3)) AS d",
    );
    const value = (rows as { d: Date }[])[0].d;
    expect(value.toISOString()).toBe("2026-01-02T03:04:05.678Z");
  });

  it("reads Traccar positions", async () => {
    const rows = await getTraccarDb().select({ id: tcPositions.id }).from(tcPositions).limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("refuses writes through the Traccar client", async () => {
    await expect(
      getTraccarDb().execute(sql`UPDATE tc_devices SET name = name WHERE 1 = 0`),
    ).rejects.toThrow();
  });
});
