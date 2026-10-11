export type WikiImage = {
  url: string;
  attribution: string;
  license: string;
  licenseUrl: string | null;
};

export type WikiSpecies = {
  title: string;
  extract: string;
  pageUrl: string | null;
  /** Only set when the image has licence information. */
  image: WikiImage | null;
};

/** A failure that may go away on retry (network, rate limit, 5xx). */
export class WikipediaError extends Error {}

export type RateLimiter = () => Promise<void>;

/** Spaces calls at least `minIntervalMs` apart. */
export function createRateLimiter(
  minIntervalMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): RateLimiter {
  let next = 0;
  return async () => {
    const start = Math.max(now(), next);
    next = start + minIntervalMs;
    const wait = start - now();
    if (wait > 0) await sleep(wait);
  };
}

export type WikipediaOptions = {
  userAgent: string;
  fetch?: typeof fetch;
  limiter?: RateLimiter;
  timeoutMs?: number;
};

const SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const THUMB_WIDTH = 640;
const WIKIMEDIA_IMAGE_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);

type SummaryResponse = {
  type?: string;
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
};

type ExtMetadata = Record<string, { value?: string } | undefined>;

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Where a file lives on upload.wikimedia.org tells us which wiki can describe it. */
export function imageFileInfo(imageUrl: string): { apiBase: string; fileName: string } | null {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  if (!WIKIMEDIA_IMAGE_HOSTS.has(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean); // wikipedia, commons, [thumb], a, ab, Name.jpg, [320px-Name.jpg]
  const wiki = parts[1];
  const thumbIndex = parts.indexOf("thumb");
  const nameIndex = thumbIndex >= 0 ? thumbIndex + 3 : 4;
  const raw = parts[nameIndex];
  if (!raw) return null;
  const apiBase =
    wiki === "commons" ? "https://commons.wikimedia.org/w/api.php" : `https://${wiki}.wikipedia.org/w/api.php`;
  return { apiBase, fileName: decodeURIComponent(raw) };
}

/** Rewrites a thumbnail URL to the given width and drops tracking parameters. */
export function thumbnailUrl(imageUrl: string, width = THUMB_WIDTH): string {
  try {
    const url = new URL(imageUrl);
    url.search = "";
    url.pathname = url.pathname.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
    return url.toString();
  } catch {
    return imageUrl;
  }
}

export class WikipediaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: RateLimiter;

  constructor(private readonly options: WikipediaOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.limiter = options.limiter ?? createRateLimiter(250);
  }

  private async getJson(url: string): Promise<{ status: number; body: unknown }> {
    await this.limiter();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { "User-Agent": this.options.userAgent, Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
    } catch (error) {
      throw new WikipediaError(`Request failed: ${(error as Error).message}`);
    }
    if (response.status === 404) return { status: 404, body: null };
    if (!response.ok) throw new WikipediaError(`HTTP ${response.status} for ${new URL(url).pathname}`);
    try {
      return { status: response.status, body: await response.json() };
    } catch {
      throw new WikipediaError(`Invalid JSON from ${new URL(url).pathname}`);
    }
  }

  /** Page summary for a title, or null when there is no (usable) article. */
  async summary(title: string): Promise<SummaryResponse | null> {
    const { body } = await this.getJson(SUMMARY_URL + encodeURIComponent(title.trim().replace(/\s+/g, "_")));
    const page = body as SummaryResponse | null;
    if (!page || page.type !== "standard" || !page.extract) return null;
    return page;
  }

  /** Licence and credit of an image, or null if Wikimedia has no licence info for it. */
  async imageLicense(imageUrl: string): Promise<Omit<WikiImage, "url"> | null> {
    const file = imageFileInfo(imageUrl);
    if (!file) return null;
    const query = new URLSearchParams({
      action: "query",
      titles: `File:${file.fileName}`,
      prop: "imageinfo",
      iiprop: "extmetadata",
      format: "json",
      formatversion: "2",
    });
    const { body } = await this.getJson(`${file.apiBase}?${query}`);
    const pages = (body as { query?: { pages?: { imageinfo?: { extmetadata?: ExtMetadata }[] }[] } } | null)?.query?.pages;
    const meta = pages?.[0]?.imageinfo?.[0]?.extmetadata;
    const license = meta?.LicenseShortName?.value?.trim();
    if (!meta || !license) return null;

    const artist = stripHtml(meta.Artist?.value ?? "");
    const credit = stripHtml(meta.Credit?.value ?? "");
    const author = artist || credit || "Unknown author";
    return {
      attribution: `${author}, via Wikimedia Commons`,
      license,
      licenseUrl: meta.LicenseUrl?.value?.trim() || null,
    };
  }

  /** Looks a species up by scientific name first, then by common name. */
  async lookupSpecies(names: { scientificName: string; commonName?: string }): Promise<WikiSpecies | null> {
    const candidates = [names.scientificName, names.commonName].filter(
      (name, i, all): name is string => Boolean(name?.trim()) && all.indexOf(name) === i,
    );
    for (const title of candidates) {
      const page = await this.summary(title);
      if (!page) continue;

      const source = page.thumbnail?.source ?? page.originalimage?.source;
      let image: WikiImage | null = null;
      if (source) {
        const license = await this.imageLicense(page.originalimage?.source ?? source);
        if (license) image = { url: thumbnailUrl(source), ...license };
      }
      return {
        title: page.title ?? title,
        extract: page.extract!,
        pageUrl: page.content_urls?.desktop?.page ?? null,
        image,
      };
    }
    return null;
  }
}
