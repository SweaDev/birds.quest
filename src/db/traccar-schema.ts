import { double, float, int, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

// Subset of Traccar's own MySQL/MariaDB tables. Traccar owns and migrates them;
// this app only ever reads them, through a SELECT-only database user.

export const tcDevices = mysqlTable("tc_devices", {
  id: int("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  uniqueId: varchar("uniqueid", { length: 128 }).notNull(),
  lastUpdate: timestamp("lastupdate", { mode: "date" }),
});

export const tcPositions = mysqlTable("tc_positions", {
  id: int("id").primaryKey(),
  deviceId: int("deviceid").notNull(),
  fixTime: timestamp("fixtime", { mode: "date" }).notNull(),
  latitude: double("latitude").notNull(),
  longitude: double("longitude").notNull(),
  speed: float("speed"),
  // JSON text, e.g. {"motion":true}
  attributes: varchar("attributes", { length: 4000 }),
});
