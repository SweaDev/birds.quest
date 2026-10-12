import { describe, expect, it, vi } from "vitest";
import {
  WikipediaClient,
  WikipediaError,
  createRateLimiter,
  imageFileInfo,
  stripHtml,
  thumbnailUrl,
} from "./wikipedia";

type Route = { match: string | RegExp; status?: number; body?: unknown };

/** A fetch stub answering by URL; records requests. */
function mockFetch(routes: Route[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})) });
    const route = routes.find((r) => (typeof r.match === "string" ? url.includes(r.match) : r.match.test(url)));
    if (!route) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const THUMB = "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Turdus_merula.jpg/320px-Turdus_merula.jpg";
const ORIGINAL = "https://upload.wikimedia.org/wikipedia/commons/5/5c/Turdus_merula.jpg";

const blackbirdPage = {
  type: "standard",
  title: "Common blackbird",
  extract: "The common blackbird is a species of true thrush.",
  content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Common_blackbird" } },
  thumbnail: { source: THUMB },
  originalimage: { source: ORIGINAL },
};

const licensed = {
  query: {
    pages: [
      {
        imageinfo: [
          {
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 4.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
              Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane &amp; Co</a>' },
            },
          },
        ],
      },
    ],
  },
};

const noLimit = async () => {};
const client = (routes: Route[]) => {
  const f = mockFetch(routes);
  return { wiki: new WikipediaClient({ userAgent: "test-agent/1 (test@example.com)", fetch: f.fn, limiter: noLimit }), ...f };
};

describe("helpers", () => {
  it("strips HTML and decodes entities", () => {
    expect(stripHtml('<a href="x">Jane &amp; Co</a> <b>1</b>')).toBe("Jane & Co 1");
  });

  it("finds the file name and wiki for thumbnail and original URLs", () => {
    const expected = { apiBase: "https://commons.wikimedia.org/w/api.php", fileName: "Turdus_merula.jpg" };
    expect(imageFileInfo(THUMB)).toEqual(expected);
    expect(imageFileInfo(ORIGINAL)).toEqual(expected);
    expect(imageFileInfo("https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Some%20File.png/220px-Some%20File.png")).toEqual({
      apiBase: "https://en.wikipedia.org/w/api.php",
      fileName: "Some File.png",
    });
    expect(
      imageFileInfo(
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1b/Great_tit_%28Parus%29.jpg/3840px-Great_tit_%28Parus%29.jpg?utm_source=en.wikipedia.org",
      ),
    ).toEqual({ apiBase: "https://commons.wikimedia.org/w/api.php", fileName: "Great_tit_(Parus).jpg" });
    expect(imageFileInfo("https://evil.example/a/b/c.jpg")).toBeNull();
    expect(imageFileInfo("not a url")).toBeNull();
  });

  it("rewrites thumbnail widths", () => {
    expect(thumbnailUrl(THUMB)).toBe(THUMB.replace("320px", "960px"));
    expect(thumbnailUrl(ORIGINAL)).toBe(ORIGINAL);
    expect(thumbnailUrl(`${THUMB}?utm_source=en.wikipedia.org&utm_campaign=api`)).toBe(THUMB.replace("320px", "960px"));
  });
});

describe("createRateLimiter", () => {
  it("spaces calls by the minimum interval", async () => {
    let clock = 1000;
    const sleeps: number[] = [];
    const limit = createRateLimiter(200, () => clock, async (ms) => {
      sleeps.push(ms);
      clock += ms;
    });
    await limit();
    await limit();
    await limit();
    expect(sleeps).toEqual([200, 200]);
    clock += 1000;
    await limit();
    expect(sleeps).toEqual([200, 200]);
  });
});

describe("WikipediaClient", () => {
  it("looks up the scientific name first and sends the User-Agent", async () => {
    const { wiki, calls } = client([
      { match: "/page/summary/Turdus_merula", body: blackbirdPage },
      { match: "commons.wikimedia.org/w/api.php", body: licensed },
    ]);
    const result = await wiki.lookupSpecies({ scientificName: "Turdus merula", commonName: "Common Blackbird" });

    expect(result).toEqual({
      title: "Common blackbird",
      extract: "The common blackbird is a species of true thrush.",
      pageUrl: "https://en.wikipedia.org/wiki/Common_blackbird",
      image: {
        url: THUMB.replace("320px", "960px"),
        attribution: "Jane & Co, via Wikimedia Commons",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      },
    });
    expect(calls[0].url).toContain("/page/summary/Turdus_merula");
    expect(calls.every((c) => c.headers["User-Agent"] === "test-agent/1 (test@example.com)")).toBe(true);
    expect(calls.some((c) => c.url.includes("Common"))).toBe(false);
  });

  it("falls back to the common name when the scientific name has no article", async () => {
    const { wiki, calls } = client([
      { match: "/page/summary/Parus_major", status: 404 },
      { match: "/page/summary/Great%20Tit", status: 404 },
      { match: "/page/summary/Great_Tit", body: { ...blackbirdPage, title: "Great tit", thumbnail: undefined, originalimage: undefined } },
    ]);
    const result = await wiki.lookupSpecies({ scientificName: "Parus major", commonName: "Great Tit" });
    expect(result?.title).toBe("Great tit");
    expect(result?.image).toBeNull();
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/api/rest_v1/page/summary/Parus_major",
      "/api/rest_v1/page/summary/Great_Tit",
    ]);
  });

  it("ignores disambiguation pages", async () => {
    const { wiki } = client([
      { match: "/page/summary/Mallard", body: { type: "disambiguation", title: "Mallard", extract: "may refer to" } },
    ]);
    expect(await wiki.lookupSpecies({ scientificName: "Mallard" })).toBeNull();
  });

  it("returns null when nothing is found", async () => {
    const { wiki } = client([]);
    expect(await wiki.lookupSpecies({ scientificName: "Nope nope", commonName: "Nope" })).toBeNull();
  });

  it("skips images without licence information but keeps the text", async () => {
    const { wiki } = client([
      { match: "/page/summary/", body: blackbirdPage },
      { match: "commons.wikimedia.org/w/api.php", body: { query: { pages: [{ imageinfo: [{ extmetadata: {} }] }] } } },
    ]);
    const result = await wiki.lookupSpecies({ scientificName: "Turdus merula" });
    expect(result?.extract).toContain("true thrush");
    expect(result?.image).toBeNull();
  });

  it("skips images that Wikimedia has no record of", async () => {
    const { wiki } = client([
      { match: "/page/summary/", body: blackbirdPage },
      { match: "commons.wikimedia.org/w/api.php", body: { query: { pages: [{ missing: true }] } } },
    ]);
    expect((await wiki.lookupSpecies({ scientificName: "Turdus merula" }))?.image).toBeNull();
  });

  it("uses the author, then the credit, for attribution", async () => {
    const meta = (extmetadata: object) => ({ query: { pages: [{ imageinfo: [{ extmetadata }] }] } });
    const { wiki } = client([
      { match: "commons.wikimedia.org/w/api.php", body: meta({ LicenseShortName: { value: "Public domain" }, Credit: { value: "<i>Own work</i>" } }) },
    ]);
    expect(await wiki.imageLicense(ORIGINAL)).toEqual({
      attribution: "Own work, via Wikimedia Commons",
      license: "Public domain",
      licenseUrl: null,
    });
  });

  it.each([429, 500, 503])("treats HTTP %i as a retryable error", async (status) => {
    const { wiki } = client([{ match: "/page/summary/", status }]);
    await expect(wiki.summary("Turdus merula")).rejects.toThrow(WikipediaError);
  });

  it("treats network failures as retryable errors", async () => {
    const wiki = new WikipediaClient({
      userAgent: "t",
      limiter: noLimit,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await expect(wiki.summary("x")).rejects.toThrow(/fetch failed/);
  });

  it("waits on the rate limiter before every request", async () => {
    const limiter = vi.fn(async () => {});
    const f = mockFetch([{ match: "/page/summary/", body: blackbirdPage }, { match: "w/api.php", body: licensed }]);
    const wiki = new WikipediaClient({ userAgent: "t", fetch: f.fn, limiter });
    await wiki.lookupSpecies({ scientificName: "Turdus merula" });
    expect(limiter).toHaveBeenCalledTimes(f.calls.length);
    expect(f.calls.length).toBe(2);
  });
});
