import {
  bigint,
  boolean,
  char,
  datetime,
  double,
  index,
  int,
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

const id = () => bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey();
const fk = (name: string) => bigint(name, { mode: "number", unsigned: true });
const ts = (name: string) => datetime(name, { mode: "date", fsp: 3 });
const createdAt = () => ts("created_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`);
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date());

export const TRIP_STATUSES = ["discovered", "predicted", "generated", "failed"] as const;
export const POST_STATUSES = ["draft", "published"] as const;
export const JOB_TYPES = ["discover", "predict", "generate"] as const;
export const JOB_STATUSES = ["pending", "running", "done", "failed"] as const;

// Trips are derived from Traccar positions. Coordinates stay in this table
// (never in prompts or public pages).
export const trips = mysqlTable(
  "trips",
  {
    id: id(),
    // Stable idempotency key, e.g. `${deviceId}:${firstFixTimeISO}`.
    sourceKey: varchar("source_key", { length: 191 }).notNull(),
    deviceId: int("device_id").notNull(),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at").notNull(),
    positionCount: int("position_count").notNull(),
    centroidLat: double("centroid_lat").notNull(),
    centroidLon: double("centroid_lon").notNull(),
    status: mysqlEnum("status", TRIP_STATUSES).notNull().default("discovered"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("trips_source_key_uq").on(t.sourceKey),
    index("trips_status_idx").on(t.status),
    index("trips_started_at_idx").on(t.startedAt),
  ],
);

export const predictions = mysqlTable(
  "predictions",
  {
    id: id(),
    tripId: fk("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    speciesCode: varchar("species_code", { length: 32 }).notNull(),
    scientificName: varchar("scientific_name", { length: 191 }).notNull(),
    commonName: varchar("common_name", { length: 191 }).notNull(),
    probability: double("probability").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("predictions_trip_species_uq").on(t.tripId, t.speciesCode),
    index("predictions_species_idx").on(t.speciesCode),
  ],
);

// Wikipedia cache, one row per species (keyed by scientific name).
export const speciesInfo = mysqlTable(
  "species_info",
  {
    id: id(),
    speciesCode: varchar("species_code", { length: 32 }).notNull(),
    scientificName: varchar("scientific_name", { length: 191 }).notNull(),
    wikiTitle: varchar("wiki_title", { length: 255 }),
    extract: text("extract"),
    pageUrl: varchar("page_url", { length: 1024 }),
    imageUrl: varchar("image_url", { length: 1024 }),
    imageAttribution: text("image_attribution"),
    imageLicense: varchar("image_license", { length: 191 }),
    imageLicenseUrl: varchar("image_license_url", { length: 1024 }),
    found: boolean("found").notNull().default(false),
    fetchedAt: ts("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex("species_info_code_uq").on(t.speciesCode),
    index("species_info_scientific_idx").on(t.scientificName),
  ],
);

export const posts = mysqlTable(
  "posts",
  {
    id: id(),
    slug: varchar("slug", { length: 191 }).notNull(),
    // One post per trip; regenerating overwrites the same post.
    tripId: fk("trip_id").references(() => trips.id, { onDelete: "set null" }),
    title: varchar("title", { length: 255 }).notNull(),
    markdown: mediumtext("markdown").notNull(),
    status: mysqlEnum("status", POST_STATUSES).notNull().default("draft"),
    generatedAt: ts("generated_at"),
    editedAt: ts("edited_at"),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("posts_slug_uq").on(t.slug),
    uniqueIndex("posts_trip_uq").on(t.tripId),
    index("posts_status_published_idx").on(t.status, t.publishedAt),
  ],
);

// Per-post species selection (owner can deselect species they did not see).
export const postSpecies = mysqlTable(
  "post_species",
  {
    postId: fk("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    speciesCode: varchar("species_code", { length: 32 }).notNull(),
    selected: boolean("selected").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.postId, t.speciesCode] })],
);

export const jobs = mysqlTable(
  "jobs",
  {
    id: id(),
    type: mysqlEnum("type", JOB_TYPES).notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    status: mysqlEnum("status", JOB_STATUSES).notNull().default("pending"),
    attempts: int("attempts").notNull().default(0),
    maxAttempts: int("max_attempts").notNull().default(5),
    runAfter: ts("run_after").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    lockedAt: ts("locked_at"),
    // Optional idempotency key; a second enqueue with the same key is ignored.
    dedupeKey: varchar("dedupe_key", { length: 191 }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("jobs_dedupe_key_uq").on(t.dedupeKey),
    index("jobs_claim_idx").on(t.status, t.runAfter),
  ],
);

export const adminSessions = mysqlTable(
  "admin_sessions",
  {
    id: id(),
    // SHA-256 hex of the session cookie value; the raw token is never stored.
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    csrfToken: char("csrf_token", { length: 64 }).notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    lastUsedAt: ts("last_used_at").notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex("admin_sessions_token_uq").on(t.tokenHash),
    index("admin_sessions_expires_idx").on(t.expiresAt),
  ],
);

export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
export type Prediction = typeof predictions.$inferSelect;
export type SpeciesInfo = typeof speciesInfo.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobType = (typeof JOB_TYPES)[number];
