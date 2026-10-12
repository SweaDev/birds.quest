import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { postSpecies, posts, predictions } from "@/db/schema";
import { enqueueJob } from "./queue";

export const MAX_TITLE = 150;
export const MAX_MARKDOWN = 100_000;

export async function savePost(db: Db, postId: number, title: string, markdown: string, now = new Date()) {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length > MAX_TITLE) throw new Error(`Title must be 1-${MAX_TITLE} characters`);
  if (markdown.length > MAX_MARKDOWN) throw new Error("Post is too long");
  await db.update(posts).set({ title: cleanTitle, markdown, editedAt: now }).where(eq(posts.id, postId));
}

export async function setPublished(db: Db, postId: number, published: boolean, now = new Date()) {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) throw new Error("Post not found");
  await db
    .update(posts)
    .set(
      published
        ? { status: "published", publishedAt: post.publishedAt ?? now }
        : { status: "draft" },
    )
    .where(eq(posts.id, postId));
}

/**
 * Stores which species the owner actually saw and queues a forced regeneration
 * of the post with exactly those species.
 */
export async function requestRegenerate(db: Db, postId: number, speciesCodes: string[], now = new Date()) {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post?.tripId) throw new Error("This post has no trip to regenerate from");
  const tripId = post.tripId;

  const predicted = await db.select().from(predictions).where(eq(predictions.tripId, tripId));
  const valid = new Set(predicted.map((p) => p.speciesCode));
  const selected = [...new Set(speciesCodes)].filter((code) => valid.has(code));
  if (selected.length === 0) throw new Error("Select at least one species");

  await db.transaction(async (tx) => {
    await tx.update(postSpecies).set({ selected: false }).where(eq(postSpecies.postId, postId));
    await tx
      .update(postSpecies)
      .set({ selected: true })
      .where(and(eq(postSpecies.postId, postId), inArray(postSpecies.speciesCode, selected)));
  });

  await enqueueJob(db, {
    type: "generate",
    payload: { tripId, speciesCodes: selected, force: true },
    // Unique per request, so repeated regenerations are not swallowed as duplicates.
    dedupeKey: `generate:regen:${postId}:${now.getTime()}`,
    runAfter: now,
  });
  return selected;
}
