import { createDb, type Db } from "@/db";

// Tests use their own database so they can truncate tables freely.
// Set TEST_DATABASE_URL, or it is derived from DATABASE_URL as `<name>_test`.
export function testDatabaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  if (!env.DATABASE_URL) return undefined;
  const url = new URL(env.DATABASE_URL);
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

export const hasTestDb = Boolean(testDatabaseUrl());

export function getTestDb(): Db {
  const url = testDatabaseUrl();
  if (!url) throw new Error("No test database configured");
  return createDb(url);
}

const TABLES = ["post_species", "posts", "predictions", "species_info", "jobs", "admin_sessions", "login_attempts", "trips"];

export async function resetTestDb(db: Db): Promise<void> {
  // FOREIGN_KEY_CHECKS is per connection, so use one dedicated connection.
  const conn = await db.$client.getConnection();
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await conn.query(`TRUNCATE TABLE \`${table}\``);
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    conn.release();
  }
}
