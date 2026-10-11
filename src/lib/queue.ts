import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { jobs, type JobType } from "@/db/schema";

export type EnqueueInput = {
  type: JobType;
  payload?: Record<string, unknown>;
  /** A job with the same key is only ever enqueued once. */
  dedupeKey?: string;
  runAfter?: Date;
};

export async function enqueueJob(db: Db, input: EnqueueInput): Promise<void> {
  await db
    .insert(jobs)
    .values({
      type: input.type,
      payload: input.payload ?? {},
      dedupeKey: input.dedupeKey,
      runAfter: input.runAfter,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
}
