// Dev-only: creates fake Traccar tables and positions for local testing.
// Usage: pnpm db:seed   (needs TRACCAR_ADMIN_DATABASE_URL in .env)
import { createConnection } from "mysql2/promise";
import { parseConfig } from "../src/lib/config";
import { buildScenarios, SEED_DEVICE_ID } from "./seed-data";

const DDL = [
  `CREATE TABLE IF NOT EXISTS tc_devices (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(128) NOT NULL,
    uniqueid VARCHAR(128) NOT NULL,
    lastupdate TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_device_uniqueid (uniqueid)
  )`,
  `CREATE TABLE IF NOT EXISTS tc_positions (
    id INT NOT NULL AUTO_INCREMENT,
    protocol VARCHAR(128) NULL,
    deviceid INT NOT NULL,
    servertime TIMESTAMP NULL DEFAULT NULL,
    devicetime TIMESTAMP NULL DEFAULT NULL,
    fixtime TIMESTAMP NULL DEFAULT NULL,
    valid BIT(1) NULL,
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    altitude FLOAT NULL,
    speed FLOAT NULL,
    course FLOAT NULL,
    address VARCHAR(512) NULL,
    attributes VARCHAR(4000) NULL,
    PRIMARY KEY (id),
    KEY idx_positions_deviceid_fixtime (deviceid, fixtime)
  )`,
];

async function main() {
  const { traccarAdminDatabaseUrl } = parseConfig(process.env);
  if (!traccarAdminDatabaseUrl) {
    throw new Error("TRACCAR_ADMIN_DATABASE_URL is not set; seeding is a dev-only tool.");
  }
  const conn = await createConnection({ uri: traccarAdminDatabaseUrl, timezone: "Z" });
  try {
    await conn.query("SET time_zone = '+00:00'");
    for (const ddl of DDL) await conn.query(ddl);

    await conn.query("DELETE FROM tc_positions WHERE deviceid = ?", [SEED_DEVICE_ID]);
    await conn.query("DELETE FROM tc_devices WHERE id = ?", [SEED_DEVICE_ID]);

    const scenarios = buildScenarios(new Date());
    const lastFix = Math.max(...scenarios.flatMap((s) => s.points.map((p) => p.fixTime.getTime())));
    await conn.query("INSERT INTO tc_devices (id, name, uniqueid, lastupdate) VALUES (?, ?, ?, ?)", [
      SEED_DEVICE_ID,
      "Dev seed phone",
      "dev-seed-phone",
      new Date(lastFix),
    ]);

    for (const { name, points } of scenarios) {
      const rows = points.map((p) => [
        "osmand",
        SEED_DEVICE_ID,
        p.fixTime,
        p.fixTime,
        p.fixTime,
        1,
        p.lat,
        p.lon,
        p.speed,
        '{"motion":true}',
      ]);
      await conn.query(
        "INSERT INTO tc_positions (protocol, deviceid, servertime, devicetime, fixtime, valid, latitude, longitude, speed, attributes) VALUES ?",
        [rows],
      );
      console.log(`seeded ${points.length} positions: ${name}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
