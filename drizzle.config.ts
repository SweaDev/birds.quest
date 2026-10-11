import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // `generate` works offline; `migrate` needs the real DATABASE_URL.
    url: process.env.DATABASE_URL ?? "mysql://user:pass@127.0.0.1:3306/birdsquest",
  },
});
