import { drizzle } from "drizzle-orm/mysql2";
import { getConfig } from "@/lib/config";
import { getPool } from "./pool";
import * as schema from "./schema";

export { closeAllPools } from "./pool";
export * as schema from "./schema";

// App database (read/write). The client is created lazily on first use.
export function getDb() {
  return drizzle(getPool(getConfig().databaseUrl), { schema, mode: "default" });
}

export type Db = ReturnType<typeof getDb>;
