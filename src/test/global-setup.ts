import { migrate } from "drizzle-orm/mysql2/migrator";
import { closeAllPools } from "@/db";
import { getTestDb, hasTestDb } from "./db";

// Keep the test database schema in sync with the migrations before any test runs.
export default async function setup() {
  if (!hasTestDb) return;
  await migrate(getTestDb(), { migrationsFolder: "./drizzle" });
  await closeAllPools();
}
