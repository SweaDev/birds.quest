import { createPool, type Pool } from "mysql2/promise";

// Keep one pool per URL across Next.js dev hot reloads.
const globalPools = globalThis as unknown as { __bqPools?: Map<string, Pool> };

export function getPool(url: string, connectionLimit = 5): Pool {
  const pools = (globalPools.__bqPools ??= new Map());
  let pool = pools.get(url);
  if (!pool) {
    // `timezone: "Z"` makes DATETIME/TIMESTAMP values round-trip as UTC.
    pool = createPool({ uri: url, timezone: "Z", connectionLimit });
    // Server-side NOW()/CURRENT_TIMESTAMP defaults must also be UTC.
    pool.pool.on("connection", (connection: { query: (sql: string) => unknown }) => {
      connection.query("SET time_zone = '+00:00'");
    });
    pools.set(url, pool);
  }
  return pool;
}

export async function closeAllPools(): Promise<void> {
  const pools = globalPools.__bqPools;
  if (!pools) return;
  globalPools.__bqPools = undefined;
  await Promise.all([...pools.values()].map((pool) => pool.end()));
}
