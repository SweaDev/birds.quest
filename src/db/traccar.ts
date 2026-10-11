import { drizzle } from "drizzle-orm/mysql2";
import { getConfig } from "@/lib/config";
import { getPool } from "./pool";
import * as traccarSchema from "./traccar-schema";

export * from "./traccar-schema";

// Read-only Traccar database client. Connect with a user that only has SELECT.
export function getTraccarDb() {
  return drizzle(getPool(getConfig().traccarDatabaseUrl, 2), {
    schema: traccarSchema,
    mode: "default",
  });
}

export type TraccarDb = ReturnType<typeof getTraccarDb>;
