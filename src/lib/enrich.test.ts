import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, predictions, speciesInfo, trips } from "@/db/schema";
import { getTestDb, hasTestDb, resetTestDb } from "@/test/db";
import { FOUND_TTL_MS, NOT_FOUND_TTL_MS, enrichTrip, getSpeciesInfo, isFresh } from "./enrich";
import { WikipediaError, type WikiSpecies } from "./wikipedia";

const found: WikiSpecies = {
  title: "Great tit",
  extract: "The great tit is a passerine bird.",
  pageUrl: "https://en.wikipedia.org/wiki/Great_tit",
  image: { url: "https://upload.wikimedia.org/x.jpg", attribution: "Jane, via Wikimedia Commons", license: "CC BY 4.0", licenseUrl: null },
};

const tit = { speciesCode: "gretit1", scientificName: "Parus major", commonName: "Great Tit" };
const t0 = new Date("2026-06-01T12:00:00Z");

describe("isFresh", () => {
  it("expires found and missing entries after different TTLs", () => {
    const fetchedAt = t0;
    const at = (ms: number) => new Date(t0.getTime() + ms);
    expect(isFresh({ found: true, fetchedAt }, at(FOUND_TTL_MS - 1))).toBe(true);
    expect(isFresh({ found: true, fetchedAt }, at(FOUND_TTL_MS))).toBe(false);
    expect(isFresh({ found: false, fetchedAt }, at(NOT_FOUND_TTL_MS - 1))).toBe(true);
    expect(isFresh({ found: false, fetchedAt }, at(NOT_FOUND_TTL_MS))).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("species info cache (database)", () => {
  const db = getTestDb();
  beforeEach(() => resetTestDb(db));

  it("fetches once, stores text, image and licence, then serves from the cache", async () => {
    const wiki = { lookupSpecies: vi.fn(async () => found) };
    const first = await getSpeciesInfo(db, tit, wiki, t0);
    const second = await getSpeciesInfo(db, tit, wiki, new Date(t0.getTime() + 1000));

    expect(wiki.lookupSpecies).toHaveBeenCalledTimes(1);
    expect(wiki.lookupSpecies).toHaveBeenCalledWith({ scientificName: "Parus major", commonName: "Great Tit" });
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      found: true,
      wikiTitle: "Great tit",
      extract: found.extract,
      imageUrl: found.image!.url,
      imageAttribution: "Jane, via Wikimedia Commons",
      imageLicense: "CC BY 4.0",
    });
  });

  it("caches misses, and retries them once stale", async () => {
    const wiki = { lookupSpecies: vi.fn(async () => null as WikiSpecies | null) };
    expect((await getSpeciesInfo(db, tit, wiki, t0)).found).toBe(false);
    await getSpeciesInfo(db, tit, wiki, new Date(t0.getTime() + 1000));
    expect(wiki.lookupSpecies).toHaveBeenCalledTimes(1);

    wiki.lookupSpecies.mockResolvedValue(found);
    const later = new Date(t0.getTime() + NOT_FOUND_TTL_MS + 1);
    expect((await getSpeciesInfo(db, tit, wiki, later)).found).toBe(true);
    expect(await db.select().from(speciesInfo)).toHaveLength(1);
  });

  it("does not cache anything when the lookup fails", async () => {
    const wiki = {
      lookupSpecies: async () => {
        throw new WikipediaError("HTTP 503");
      },
    };
    await expect(getSpeciesInfo(db, tit, wiki, t0)).rejects.toThrow("HTTP 503");
    expect(await db.select().from(speciesInfo)).toHaveLength(0);
  });

  describe("enrichTrip", () => {
    async function tripWithPredictions() {
      await db.insert(trips).values({
        sourceKey: "1:t",
        deviceId: 1,
        startedAt: t0,
        endedAt: new Date(t0.getTime() + 20 * 60_000),
        positionCount: 10,
        centroidLat: 52,
        centroidLon: 13,
        status: "predicted",
      });
      const [trip] = await db.select().from(trips);
      await db.insert(predictions).values([
        { tripId: trip.id, ...tit, probability: 0.9 },
        { tripId: trip.id, speciesCode: "eurbla", scientificName: "Turdus merula", commonName: "Common Blackbird", probability: 0.8 },
      ]);
      return trip.id;
    }

    it("caches every species and queues generation once", async () => {
      const tripId = await tripWithPredictions();
      const wiki = { lookupSpecies: vi.fn(async () => found) };
      await enrichTrip(db, tripId, wiki, t0);
      await enrichTrip(db, tripId, wiki, t0);

      expect(await db.select().from(speciesInfo)).toHaveLength(2);
      expect(wiki.lookupSpecies).toHaveBeenCalledTimes(2);
      const generate = await db.select().from(jobs).where(eq(jobs.type, "generate"));
      expect(generate).toMatchObject([{ payload: { tripId }, dedupeKey: `generate:${tripId}` }]);
    });

    it("keeps the species that worked and fails the job so it is retried", async () => {
      const tripId = await tripWithPredictions();
      const lookupSpecies = vi.fn(async ({ scientificName }: { scientificName: string }) => {
        if (scientificName === "Parus major") throw new WikipediaError("HTTP 429");
        return found;
      });
      await expect(enrichTrip(db, tripId, { lookupSpecies }, t0)).rejects.toThrow(/1 species.*Parus major/);
      expect(await db.select().from(speciesInfo)).toHaveLength(1);
      expect(await db.select().from(jobs).where(eq(jobs.type, "generate"))).toHaveLength(0);

      // The retry only looks up the missing species.
      lookupSpecies.mockClear();
      lookupSpecies.mockResolvedValue(found);
      await enrichTrip(db, tripId, { lookupSpecies }, t0);
      expect(lookupSpecies).toHaveBeenCalledTimes(1);
      expect(await db.select().from(jobs).where(eq(jobs.type, "generate"))).toHaveLength(1);
    });

    it("still queues generation when Wikipedia has no article for a species", async () => {
      const tripId = await tripWithPredictions();
      await enrichTrip(db, tripId, { lookupSpecies: async () => null }, t0);
      expect(await db.select().from(jobs).where(eq(jobs.type, "generate"))).toHaveLength(1);
    });
  });
});
