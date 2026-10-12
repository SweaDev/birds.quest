import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminSessions, jobs, postSpecies, posts, predictions, trips } from "@/db/schema";
import { getTestDb, hasTestDb, resetTestDb } from "@/test/db";
import {
  MAX_FAILED_PER_IP,
  SESSION_TTL_MS,
  createSession,
  csrfValid,
  destroySession,
  findSession,
  hashPassword,
  isLoginBlocked,
  recordFailedLogin,
  verifyPassword,
} from "./auth";
import { requestRegenerate, setPublished } from "./post-admin";

const secret = "s".repeat(40);

describe("passwords", () => {
  it("verifies the right password only, and survives a broken hash", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("admin sessions and login limits (database)", () => {
  const db = getTestDb();
  const now = new Date("2026-06-01T12:00:00Z");
  beforeEach(() => resetTestDb(db));

  it("stores only a keyed hash of the token, and finds the session by token", async () => {
    const session = await createSession(db, secret, now);
    const [row] = await db.select().from(adminSessions);
    expect(row.tokenHash).not.toContain(session.token);
    expect(await findSession(db, session.token, secret, now)).toMatchObject({ csrfToken: session.csrfToken });
    expect(await findSession(db, session.token, "other-secret".repeat(4), now)).toBeNull();
    expect(await findSession(db, "garbage", secret, now)).toBeNull();
    expect(await findSession(db, undefined, secret, now)).toBeNull();
  });

  it("expires sessions and supports logout", async () => {
    const session = await createSession(db, secret, now);
    expect(await findSession(db, session.token, secret, new Date(now.getTime() + SESSION_TTL_MS + 1))).toBeNull();
    await destroySession(db, session.token, secret);
    expect(await findSession(db, session.token, secret, now)).toBeNull();
  });

  it("checks the CSRF token", async () => {
    const session = await createSession(db, secret, now);
    expect(csrfValid(session, session.csrfToken)).toBe(true);
    expect(csrfValid(session, "nope")).toBe(false);
    expect(csrfValid(session, null)).toBe(false);
  });

  it("blocks an IP after too many failed logins, for a limited time", async () => {
    for (let i = 0; i < MAX_FAILED_PER_IP; i++) {
      expect(await isLoginBlocked(db, "1.2.3.4", now)).toBe(false);
      await recordFailedLogin(db, "1.2.3.4", now);
    }
    expect(await isLoginBlocked(db, "1.2.3.4", now)).toBe(true);
    expect(await isLoginBlocked(db, "5.6.7.8", now)).toBe(false);
    expect(await isLoginBlocked(db, "1.2.3.4", new Date(now.getTime() + 16 * 60_000))).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("post admin actions (database)", () => {
  const db = getTestDb();
  const now = new Date("2026-06-01T12:00:00Z");
  beforeEach(() => resetTestDb(db));

  async function seed() {
    await db.insert(trips).values({
      sourceKey: "1:t", deviceId: 1, startedAt: now, endedAt: now, positionCount: 1, centroidLat: 1, centroidLon: 1,
    });
    const [trip] = await db.select().from(trips);
    await db.insert(predictions).values([
      { tripId: trip.id, speciesCode: "a", scientificName: "A a", commonName: "A", probability: 0.9 },
      { tripId: trip.id, speciesCode: "b", scientificName: "B b", commonName: "B", probability: 0.8 },
    ]);
    await db.insert(posts).values({ slug: "p-1", tripId: trip.id, title: "T", markdown: "m" });
    const [post] = await db.select().from(posts);
    await db.insert(postSpecies).values([
      { postId: post.id, speciesCode: "a", selected: true },
      { postId: post.id, speciesCode: "b", selected: true },
    ]);
    return { tripId: trip.id, postId: post.id };
  }

  it("regenerate stores the species selection and queues a forced generate job", async () => {
    const { tripId, postId } = await seed();
    await requestRegenerate(db, postId, ["a", "zzz"], now);

    const rows = await db.select().from(postSpecies);
    expect(rows.map((r) => [r.speciesCode, r.selected]).sort()).toEqual([["a", true], ["b", false]]);
    const [job] = await db.select().from(jobs).where(eq(jobs.type, "generate"));
    expect(job.payload).toEqual({ tripId, speciesCodes: ["a"], force: true });

    // A second request is its own job, not swallowed as a duplicate.
    await requestRegenerate(db, postId, ["a", "b"], new Date(now.getTime() + 1000));
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("regenerate needs at least one valid species", async () => {
    const { postId } = await seed();
    await expect(requestRegenerate(db, postId, [], now)).rejects.toThrow(/at least one/);
    await expect(requestRegenerate(db, postId, ["zzz"], now)).rejects.toThrow(/at least one/);
  });

  it("publishing sets the date once, unpublishing keeps it", async () => {
    const { postId } = await seed();
    await setPublished(db, postId, true, now);
    await setPublished(db, postId, false, now);
    await setPublished(db, postId, true, new Date(now.getTime() + 60_000));
    const [post] = await db.select().from(posts);
    expect(post).toMatchObject({ status: "published", publishedAt: now });
  });
});
