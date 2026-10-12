import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { postSpecies, posts, predictions, speciesInfo, trips, type SpeciesInfo } from "@/db/schema";
import { getTestDb, hasTestDb, resetTestDb } from "@/test/db";
import { LlmError, type LlmClient } from "./llm";
import { findLocationLeaks, hasLocationLeak } from "./locations";
import {
  LeakError,
  buildMessages,
  buildPost,
  cleanAttribution,
  cleanMarkdown,
  generatePost,
  parseDraft,
  parseGenerateJob,
  slugify,
  speciesFacts,
  timeOfYear,
  type PostSpecies,
} from "./posts";

const info = (over: Partial<SpeciesInfo> = {}): SpeciesInfo => ({
  id: 1,
  speciesCode: "gretit1",
  scientificName: "Parus major",
  wikiTitle: "Great tit",
  extract:
    "The great tit is a small passerine bird in the tit family. It is native to Europe, Asia and North Africa. It has a black head and white cheeks.",
  pageUrl: "https://en.wikipedia.org/wiki/Great_tit",
  imageUrl: "https://upload.wikimedia.org/tit/640px-Tit.jpg",
  imageAttribution: "Jane Doe, via Wikimedia Commons",
  imageLicense: "CC BY 4.0",
  imageLicenseUrl: "https://creativecommons.org/licenses/by/4.0",
  found: true,
  fetchedAt: new Date(),
  ...over,
});

const tit: PostSpecies = { code: "gretit1", commonName: "Great Tit", scientificName: "Parus major", probability: 0.9, info: info() };
const robin: PostSpecies = {
  code: "eurrob1",
  commonName: "European Robin",
  scientificName: "Erithacus rubecula",
  probability: 0.8,
  info: null,
};
const when = timeOfYear(new Date("2026-06-10T08:00:00Z"), false);

const reply = `# A Cheerful Walk

A lovely intro. You might hear many songs.

## Great Tit
A lively bird that you might spot.

## European Robin
A friendly little bird.

## Final thoughts
Enjoy the walk!`;

const stub = (text: string | Error) => {
  const complete = vi.fn<LlmClient["complete"]>(async () => {
    if (text instanceof Error) throw text;
    return text;
  });
  return { complete };
};

describe("timeOfYear", () => {
  it.each([
    ["2026-06-03T00:00:00Z", false, "early", "June", "summer"],
    ["2026-06-10T00:00:00Z", false, "mid", "June", "summer"],
    ["2026-06-17T00:00:00Z", false, "mid", "June", "summer"],
    ["2026-06-28T00:00:00Z", false, "late", "June", "summer"],
    ["2026-12-25T00:00:00Z", false, "late", "December", "winter"],
    ["2026-03-01T00:00:00Z", false, "early", "March", "spring"],
    ["2026-10-10T00:00:00Z", false, "mid", "October", "autumn"],
    ["2026-06-10T00:00:00Z", true, "mid", "June", "winter"],
    ["2026-12-10T00:00:00Z", true, "mid", "December", "summer"],
  ])("%s (southern=%s) is %s %s, %s", (date, southern, period, month, season) => {
    expect(timeOfYear(new Date(date), southern)).toEqual({ period, month, season });
  });
});

describe("speciesFacts", () => {
  it("keeps facts but drops sentences that name places", () => {
    const facts = speciesFacts(tit);
    expect(facts).toContain("small passerine bird");
    expect(facts).toContain("black head");
    expect(facts).not.toMatch(/Europe|Asia|Africa/);
  });

  it("drops range talk that names a continent, a hemisphere or another country's birds", () => {
    const magpie: PostSpecies = {
      ...tit,
      info: info({
        extract:
          "The magpie is a bold bird. It is resident throughout the northern part of the continent. It is not related to the Australian magpie. It breeds in the northern hemisphere.",
      }),
    };
    expect(speciesFacts(magpie)).toBe("The magpie is a bold bird.");
  });

  it("returns nothing without an extract and trims long text", () => {
    expect(speciesFacts(robin)).toBe("");
    const long = { ...tit, info: info({ extract: "Birds sing loudly every morning. ".repeat(40) }) };
    expect(speciesFacts(long, 50, 100).length).toBeLessThanOrEqual(101);
  });
});

describe("buildMessages (privacy)", () => {
  const names = [tit, robin].flatMap((s) => [s.commonName, s.scientificName]);

  it("sends only species, facts and the time of year", () => {
    const text = buildMessages([tit, robin], when)
      .map((m) => m.content)
      .join("\n");
    expect(text).toContain("Time of year: mid June (summer)");
    expect(text).toContain("Great Tit (Parus major)");
    expect(text).toContain("small passerine bird");
    expect(text).not.toContain("Facts: undefined");
  });

  it("contains no coordinates, links or place names, even though Wikipedia named some", () => {
    const text = buildMessages([tit, robin], when)
      .map((m) => m.content)
      .join("\n");
    expect(tit.info!.extract).toContain("Europe");
    expect(findLocationLeaks(text, names)).toEqual({ hard: [], places: [] });
  });
});

describe("cleanMarkdown", () => {
  it("removes images, links, html and code fences", () => {
    expect(cleanMarkdown("Hi ![x](http://a/b.png) [site](http://a) <b>bold</b> ```md")).toBe("Hi site bold");
  });
});

describe("cleanAttribution", () => {
  it.each([
    ["Frank Vassen from Brussels, Belgium", "Frank Vassen"],
    ["Bengt Nyman from Vaxholm, Sweden", "Bengt Nyman"],
    ["Giacomo Cimino (foto.giacomocimino.workers.dev · @giacomociminoph)", "Giacomo Cimino"],
    ["Jane Doe https://example.com/jane", "Jane Doe"],
    ["Andreas Trepte", "Andreas Trepte"],
    ["Alexis Lours", "Alexis Lours"],
  ])("%s -> %s", (input, expected) => {
    expect(cleanAttribution(input)).toBe(expected);
  });

  it("falls back to a neutral credit when nothing usable is left", () => {
    expect(cleanAttribution("Photographed in Germany")).toBe("Wikimedia Commons contributor");
  });

  it("is applied to the credit line of the post", async () => {
    const withPlace: PostSpecies = { ...tit, info: info({ imageAttribution: "Frank Vassen from Brussels, Belgium, via Wikimedia Commons" }) };
    const built = await buildPost([withPlace], when, stub(reply));
    expect(built.markdown).toContain("*Photo: Frank Vassen, via Wikimedia Commons, [CC BY 4.0]");
    expect(built.markdown).not.toMatch(/Brussels|Belgium/);
  });
});

describe("parseDraft", () => {
  it("extracts title, intro, species blurbs and outro", () => {
    const draft = parseDraft(reply, [tit, robin]);
    expect(draft.title).toBe("A Cheerful Walk");
    expect(draft.intro).toContain("lovely intro");
    expect(draft.blurbs.get("gretit1")).toBe("A lively bird that you might spot.");
    expect(draft.blurbs.get("eurrob1")).toBe("A friendly little bird.");
    expect(draft.outro).toBe("Enjoy the walk!");
  });

  it("removes sentences naming places but keeps the rest", () => {
    const draft = parseDraft(
      "# T\n\nIntro here. It is great in Germany.\n\n## Great Tit\nA lively bird. Often seen near Paris.",
      [tit],
    );
    expect(draft.intro).toBe("Intro here.");
    expect(draft.blurbs.get("gretit1")).toBe("A lively bird.");
    expect(draft.removedSentences).toBe(2);
  });

  it("ignores unknown sections and keeps species names that contain place words", () => {
    const vulture: PostSpecies = { ...tit, code: "turvul", commonName: "Turkey Vulture", scientificName: "Cathartes aura", info: null };
    const draft = parseDraft("# T\n\nI.\n\n## Turkey Vulture\nA big bird.\n\n## Somewhere else\nIgnored.", [vulture]);
    expect(draft.blurbs.get("turvul")).toBe("A big bird.");
    expect(draft.blurbs.size).toBe(1);
  });

  it("drops a title that names a place or is too long", () => {
    expect(parseDraft("# Birds of Germany\n\nIntro.", [tit]).title).toBeNull();
    expect(parseDraft(`# ${"x".repeat(150)}\n\nIntro.`, [tit]).title).toBeNull();
  });

  it.each(["Found at 52.5140, 13.3500.", "See https://example.com now.", "Its latitude is high."])(
    "rejects output with %s",
    (leak) => {
      expect(() => parseDraft(`# T\n\n${leak}\n\n## Great Tit\nx`, [tit])).toThrow(LeakError);
    },
  );
});

describe("buildPost", () => {
  it("assembles intro, species sections with licensed images, and attribution", async () => {
    const built = await buildPost([tit, robin], when, stub(reply));
    expect(built.title).toBe("A Cheerful Walk");
    expect(built.usedFallback).toBe(false);
    expect(built.markdown).toContain("A lovely intro.");
    expect(built.markdown).toContain("## Great Tit\n\n*Parus major*");
    expect(built.markdown).toContain("![Great Tit](https://upload.wikimedia.org/tit/640px-Tit.jpg)");
    expect(built.markdown).toContain(
      "*Photo: Jane Doe, via Wikimedia Commons, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0).*",
    );
    expect(built.markdown).toContain("[Read more on Wikipedia](https://en.wikipedia.org/wiki/Great_tit)");
    expect(built.markdown).toContain("not confirmed sightings");
    // The robin has no Wikipedia info, so no image block.
    const robinSection = built.markdown.split("## European Robin")[1].split("## Final thoughts")[0];
    expect(robinSection).not.toContain("![");
  });

  it("never lets the model add images or links, or place names", async () => {
    const built = await buildPost(
      [tit],
      when,
      stub(
        "# T\n\nIntro ![x](http://evil/x.png) [click](http://evil).\n\n## Great Tit\nLives in Germany. Sings well.\n\n## Final thoughts\nBye.",
      ),
    );
    expect(built.markdown).not.toContain("evil");
    expect(built.markdown).not.toContain("Germany");
    expect(built.markdown).toContain("Sings well.");
    expect(built.removedSentences).toBe(1);
  });

  it("falls back to the template when the LLM fails", async () => {
    const log = vi.fn();
    const built = await buildPost([tit, robin], when, stub(new LlmError("down", true)), log);
    expect(built.usedFallback).toBe(true);
    expect(built.title).toBe("Birds you might spot on a walk in mid June");
    expect(built.markdown).toContain("## Great Tit");
    expect(built.markdown).toContain("## European Robin");
    expect(built.markdown).toContain("small passerine bird");
    expect(built.markdown).toContain("might come across");
    expect(log).toHaveBeenCalled();
    const withoutLinks = built.markdown.replace(/\[[^\]]*\]\([^)]*\)/g, "");
    expect(hasLocationLeak(withoutLinks, ["Great Tit", "European Robin"])).toBe(false);
  });

  it("falls back when the output contains coordinates", async () => {
    const built = await buildPost([tit], when, stub("# T\n\nWalk at 52.5140, 13.3500.\n\n## Great Tit\nx"));
    expect(built.usedFallback).toBe(true);
    expect(built.markdown).not.toContain("52.51");
  });

  it("fills in sections the model skipped", async () => {
    const built = await buildPost([tit, robin], when, stub("# T\n\nIntro.\n\n## Great Tit\nOnly the tit."));
    expect(built.markdown).toContain("Only the tit.");
    expect(built.markdown).toContain("European Robin");
    expect(built.markdown).toContain("might come across");
    expect(built.usedFallback).toBe(false);
  });
});

describe("slugify", () => {
  it("makes url-safe slugs", () => {
    expect(slugify("Birds you might spot on a walk in mid June")).toBe("birds-you-might-spot-on-a-walk-in-mid-june");
    expect(slugify("Crème brûlée!!")).toBe("creme-brulee");
    expect(slugify("???")).toBe("post");
    expect(slugify("a".repeat(200), 20)).toHaveLength(20);
  });
});

describe("parseGenerateJob", () => {
  it("reads tripId, species selection and force", () => {
    expect(parseGenerateJob({ type: "generate", payload: { tripId: 4 } })).toEqual({
      tripId: 4,
      speciesCodes: undefined,
      force: false,
    });
    expect(parseGenerateJob({ type: "generate", payload: { tripId: 4, speciesCodes: ["a"], force: true } })).toEqual({
      tripId: 4,
      speciesCodes: ["a"],
      force: true,
    });
  });

  it("rejects bad payloads", () => {
    expect(() => parseGenerateJob({ type: "generate", payload: {} })).toThrow(/tripId/);
    expect(() => parseGenerateJob({ type: "generate", payload: { tripId: 1, speciesCodes: "a" } })).toThrow(
      /speciesCodes/,
    );
  });
});

describe.skipIf(!hasTestDb)("generatePost (database)", () => {
  const db = getTestDb();
  beforeEach(() => resetTestDb(db));
  const now = new Date("2026-06-10T12:00:00Z");

  async function seed() {
    await db.insert(trips).values({
      sourceKey: "1:t",
      deviceId: 1,
      startedAt: new Date("2026-06-10T08:00:00Z"),
      endedAt: new Date("2026-06-10T09:00:00Z"),
      positionCount: 100,
      centroidLat: 52.514,
      centroidLon: 13.35,
      status: "predicted",
    });
    const [trip] = await db.select().from(trips);
    await db.insert(predictions).values([
      { tripId: trip.id, speciesCode: tit.code, scientificName: tit.scientificName, commonName: tit.commonName, probability: 0.9 },
      { tripId: trip.id, speciesCode: robin.code, scientificName: robin.scientificName, commonName: robin.commonName, probability: 0.8 },
    ]);
    const { id: _id, ...titInfo } = info();
    void _id;
    await db.insert(speciesInfo).values(titInfo);
    return trip.id;
  }

  const selection = async () =>
    (await db.select().from(postSpecies)).map((r) => [r.speciesCode, r.selected] as const).sort();

  it("saves a draft with a slug, species selection and the trip marked generated", async () => {
    const tripId = await seed();
    const result = await generatePost(db, { tripId }, { llm: stub(reply), now });

    expect(result).toMatchObject({ skipped: false, usedFallback: false });
    const [post] = await db.select().from(posts);
    expect(post).toMatchObject({ tripId, status: "draft", title: "A Cheerful Walk", slug: `a-cheerful-walk-${tripId}` });
    expect(post.generatedAt).toEqual(now);
    expect(post.markdown).toContain("## Great Tit");
    expect(await selection()).toEqual([
      ["eurrob1", true],
      ["gretit1", true],
    ]);
    expect((await db.select().from(trips))[0].status).toBe("generated");
  });

  it("sends no coordinates, trip details or place names to the LLM", async () => {
    const tripId = await seed();
    const llm = stub(reply);
    await generatePost(db, { tripId }, { llm, now });

    const sent = JSON.stringify(llm.complete.mock.calls);
    for (const secret of ["52.5", "13.3", "52.514", "13.35", "Berlin", "Germany", "latitude", "centroid", "sourceKey", "1:t"]) {
      expect(sent).not.toContain(secret);
    }
    expect(sent).not.toMatch(/\bEurope\b/);
    expect(sent).toContain("mid June");
  });

  it("leaves an existing post alone unless forced", async () => {
    const tripId = await seed();
    await generatePost(db, { tripId }, { llm: stub(reply), now });
    const llm = stub(reply);
    const again = await generatePost(db, { tripId }, { llm, now });
    expect(again.skipped).toBe(true);
    expect(llm.complete).not.toHaveBeenCalled();
    expect(await db.select().from(posts)).toHaveLength(1);
  });

  it("regenerates with a species selection, keeping slug and publish state", async () => {
    const tripId = await seed();
    await generatePost(db, { tripId }, { llm: stub(reply), now });
    const [first] = await db.select().from(posts);
    await db
      .update(posts)
      .set({ status: "published", editedAt: now, markdown: "my manual text" })
      .where(eq(posts.id, first.id));

    const llm = stub("# New Title\n\nFresh intro.\n\n## Great Tit\nJust the tit.\n\n## Final thoughts\nDone.");
    const later = new Date("2026-06-11T00:00:00Z");
    await generatePost(db, { tripId, speciesCodes: ["gretit1"], force: true }, { llm, now: later });

    const [post] = await db.select().from(posts);
    expect(post).toMatchObject({ id: first.id, slug: first.slug, status: "published", title: "New Title", editedAt: null });
    expect(post.generatedAt).toEqual(later);
    expect(post.markdown).toContain("Just the tit.");
    expect(post.markdown).not.toContain("European Robin");
    expect(JSON.stringify(llm.complete.mock.calls)).not.toContain("European Robin");
    expect(await selection()).toEqual([
      ["eurrob1", false],
      ["gretit1", true],
    ]);
  });

  it("remembers the previous selection when regenerating without one", async () => {
    const tripId = await seed();
    await generatePost(db, { tripId }, { llm: stub(reply), now });
    await generatePost(db, { tripId, speciesCodes: ["eurrob1"], force: true }, { llm: stub(reply), now });
    const llm = stub(reply);
    await generatePost(db, { tripId, force: true }, { llm, now });
    expect(JSON.stringify(llm.complete.mock.calls)).not.toContain("Great Tit");
  });

  it("publishes a new post at once with autoPublish, but never changes an existing post", async () => {
    const tripId = await seed();
    await generatePost(db, { tripId }, { llm: stub(reply), now, autoPublish: true });
    const [post] = await db.select().from(posts);
    expect(post.status).toBe("published");
    expect(post.publishedAt).toEqual(now);

    await db.update(posts).set({ status: "draft", publishedAt: null });
    await generatePost(db, { tripId, force: true }, { llm: stub(reply), now, autoPublish: true });
    expect((await db.select().from(posts))[0].status).toBe("draft");
  });

  it("uses the template when the LLM is down and still saves a draft", async () => {
    const tripId = await seed();
    const result = await generatePost(db, { tripId }, { llm: stub(new LlmError("down", true)), now });
    expect(result.usedFallback).toBe(true);
    const [post] = await db.select().from(posts);
    expect(post.title).toBe("Birds you might spot on a walk in mid June");
    expect(post.status).toBe("draft");
  });

  it("fails for unknown trips, empty selections, and trips without predictions", async () => {
    await expect(generatePost(db, { tripId: 99 }, { llm: stub(reply), now })).rejects.toThrow(/not found/);
    const tripId = await seed();
    await expect(generatePost(db, { tripId, speciesCodes: [] }, { llm: stub(reply), now })).rejects.toThrow(
      /at least one/,
    );
    await db.delete(predictions);
    await expect(generatePost(db, { tripId }, { llm: stub(reply), now })).rejects.toThrow(/no predictions/);
  });

  it("uses the southern-hemisphere season for trips south of the equator", async () => {
    const tripId = await seed();
    await db.update(trips).set({ centroidLat: -33.9 }).where(eq(trips.id, tripId));
    const llm = stub(reply);
    await generatePost(db, { tripId }, { llm, now });
    const sent = JSON.stringify(llm.complete.mock.calls);
    expect(sent).toContain("(winter)");
    expect(sent).not.toContain("33.9");
  });
});
