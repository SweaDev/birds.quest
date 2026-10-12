import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "@/db";
import {
  postSpecies,
  posts,
  predictions,
  speciesInfo,
  trips,
  type Job,
  type SpeciesInfo,
} from "@/db/schema";
import { findLocationLeaks, hasLocationLeak, splitSentences, stripPlaceSentences } from "./locations";
import type { ChatMessage, LlmClient } from "./llm";
import { midTime, tripIdFromJob, weekOfDate } from "./predict";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type Season = "winter" | "spring" | "summer" | "autumn";
export type TimeOfYear = { month: string; period: "early" | "mid" | "late"; season: Season };

export type PostSpecies = {
  code: string;
  commonName: string;
  scientificName: string;
  probability: number;
  info: SpeciesInfo | null;
};

export type GenerateInput = {
  tripId: number;
  /** Species to include; others are deselected. Defaults to the post's current selection, or everything. */
  speciesCodes?: string[];
  /** Overwrite an existing post (regenerate). Without it an existing post is left alone. */
  force?: boolean;
};

export type GenerateDeps = {
  llm: LlmClient;
  now?: Date;
  log?: (message: string) => void;
};

export type GenerateResult = {
  postId: number | null;
  skipped: boolean;
  usedFallback: boolean;
  removedSentences: number;
};

// ---------------------------------------------------------------- time of year

/** Season in the hemisphere of the trip. Only the season name is ever sent to the LLM, never the latitude. */
export function timeOfYear(date: Date, southernHemisphere: boolean): TimeOfYear {
  const month = date.getUTCMonth();
  const weekInMonth = (weekOfDate(date) - 1) % 4; // 0..3
  const shifted = southernHemisphere ? (month + 6) % 12 : month;
  const season: Season =
    shifted === 11 || shifted <= 1 ? "winter" : shifted <= 4 ? "spring" : shifted <= 7 ? "summer" : "autumn";
  return { month: MONTHS[month], period: weekInMonth === 0 ? "early" : weekInMonth === 3 ? "late" : "mid", season };
}

const timeLabel = (t: TimeOfYear) => `${t.period} ${t.month}`;

// ------------------------------------------------------------------- facts

function allowedNames(species: PostSpecies[]): string[] {
  return species.flatMap((s) => [s.commonName, s.scientificName, s.info?.wikiTitle ?? ""]).filter(Boolean);
}

/** A few location-free sentences from the Wikipedia extract. */
export function speciesFacts(species: PostSpecies, maxSentences = 3, maxChars = 400): string {
  const extract = species.info?.extract;
  if (!extract) return "";
  const cleaned = extract.replace(/\[\d+\]/g, "").replace(/\s+/g, " ");
  const names = allowedNames([species]);
  let facts = splitSentences(cleaned)
    .filter((sentence) => !hasLocationLeak(sentence, names))
    .slice(0, maxSentences)
    .join(" ");
  if (facts.length > maxChars) facts = `${facts.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
  return facts;
}

// ------------------------------------------------------------------ prompt

const SYSTEM_PROMPT = `You write short, friendly posts for a bird watching blog.
The post describes birds that anyone might see on a walk at a certain time of year. The birds are predictions, not confirmed sightings, so use wording like "might", "could" or "you may spot". Never say they were definitely seen.

Strict rules:
- Use only the species and facts you are given. Do not invent facts.
- Never mention any place or anything that points to one: no countries, regions, cities, parks, landmarks, directions or distances.
- Do not use links, images, HTML or tables.

Reply in Markdown in exactly this shape:
# <a short, catchy title>

<an intro of 2-3 sentences>

## <Common name of species 1>
<1-2 sentences about this bird>

## <Common name of species 2>
<1-2 sentences about this bird>

(...one section per species, in the order given, headings exactly the common names...)

## Final thoughts
<1-2 closing sentences>`;

/** Builds the only text the LLM ever sees: species, Wikipedia facts and time of year. */
export function buildMessages(species: PostSpecies[], when: TimeOfYear): ChatMessage[] {
  const lines = species.map((s, i) => {
    const facts = speciesFacts(s);
    return `${i + 1}. ${s.commonName} (${s.scientificName})${facts ? `\n   Facts: ${facts}` : ""}`;
  });
  const user = [
    `Time of year: ${timeLabel(when)} (${when.season})`,
    `Species (${species.length}):`,
    ...lines,
    "",
    "Write the post now.",
  ].join("\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

// ---------------------------------------------------------- output handling

export class LeakError extends Error {}

/** Removes everything but plain Markdown text: images, links, HTML, code fences, URLs. */
export function cleanMarkdown(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>\n]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type Draft = {
  title: string | null;
  intro: string;
  outro: string;
  blurbs: Map<string, string>;
  removedSentences: number;
};

/** Parses and sanitises the model's reply. Throws LeakError when it contains coordinates or links. */
export function parseDraft(raw: string, species: PostSpecies[]): Draft {
  const names = allowedNames(species);
  // Links and images are stripped later, so only what would survive cleaning counts as a leak.
  const leaks = findLocationLeaks(cleanMarkdown(raw), names);
  if (leaks.hard.length > 0) throw new LeakError(`Model output contains ${leaks.hard.join(", ")}`);

  let removed = 0;
  const clean = (chunk: string): string => {
    const result = stripPlaceSentences(cleanMarkdown(chunk), names);
    removed += result.removed.length;
    return result.text;
  };

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let title: string | null = null;
  const intro: string[] = [];
  const sections: { heading: string; body: string[] }[] = [];

  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line);
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) sections.push({ heading: h2[1], body: [] });
    else if (h1 && title === null && sections.length === 0) title = h1[1];
    else if (sections.length > 0) sections.at(-1)!.body.push(line);
    else intro.push(line);
  }

  // Longest names first, so "Great Tit" is not mistaken for a species named "Great Tit Something".
  const byNameLength = [...species].sort((a, b) => b.commonName.length - a.commonName.length);
  const blurbs = new Map<string, string>();
  let outro = "";
  for (const section of sections) {
    const heading = normalize(section.heading.replace(/[*_`]/g, ""));
    const body = clean(section.body.join(" "));
    if (/^(final|closing|wrap|last)\b/.test(heading) || /\b(final thoughts|closing thoughts)\b/.test(heading)) {
      outro = body;
      continue;
    }
    const match = byNameLength.find(
      (s) => heading.startsWith(normalize(s.commonName)) || heading.includes(normalize(s.scientificName)),
    );
    if (match && body && !blurbs.has(match.code)) blurbs.set(match.code, body);
  }

  let cleanTitle: string | null = null;
  if (title) {
    const candidate = cleanMarkdown(title).replace(/[*_`#]/g, "").trim();
    if (candidate && candidate.length <= 100 && !hasLocationLeak(candidate, names)) cleanTitle = candidate;
    else if (candidate) removed++;
  }

  return { title: cleanTitle, intro: clean(intro.join(" ")), outro, blurbs, removedSentences: removed };
}

// ---------------------------------------------------------------- templates

export const templateTitle = (when: TimeOfYear) => `Birds you might spot on a walk in ${timeLabel(when)}`;

export const templateIntro = (when: TimeOfYear) =>
  `${when.season[0].toUpperCase()}${when.season.slice(1)} walks can bring plenty of birdsong. ` +
  `Here are the birds that anyone might see on a walk in ${timeLabel(when)}, ` +
  `predicted from the time of year and the route rather than seen for certain.`;

export const templateOutro = () =>
  "Keep your eyes and ears open, and see how many of these you can find on your own walk.";

export function templateBlurb(species: PostSpecies): string {
  const facts = speciesFacts(species, 2);
  return facts || `The ${species.commonName} is one of the birds you might come across at this time of year.`;
}

// ----------------------------------------------------------------- assembly

const escapeLinkText = (s: string) => s.replace(/[[\]]/g, "");

/**
 * Photographer credits keep the author's name (the licence needs it) but not links,
 * social handles or "from <place>" tails, which would put places on the page.
 */
export function cleanAttribution(text: string): string {
  const cleaned = text
    .replace(/\([^)]*(?:https?:|www\.|@|\.com|\.org|\.net|\.dev)[^)]*\)/gi, "")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/\S*\.(?:com|org|net|dev|io)\S*/gi, "")
    .replace(/\s@\S+/g, "")
    .replace(/\s+from\s+\p{Lu}[^,.;]*(?:,\s*\p{Lu}[^,.;]*)*/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripPlaceSentences(cleaned).text.replace(/\s+,/g, ",") || "Wikimedia Commons contributor";
}

function imageBlock(species: PostSpecies): string {
  const info = species.info;
  if (!info?.imageUrl || !info.imageLicense) return "";
  const author = cleanAttribution((info.imageAttribution ?? "").replace(/,?\s*via Wikimedia Commons$/i, ""));
  const license = info.imageLicenseUrl ? `[${escapeLinkText(info.imageLicense)}](${info.imageLicenseUrl})` : info.imageLicense;
  const credit = `*Photo: ${escapeLinkText(author)}, via Wikimedia Commons, ${license}.*`;
  return `![${escapeLinkText(species.commonName)}](${info.imageUrl})\n\n${credit}`;
}

export function assembleMarkdown(parts: {
  intro: string;
  outro: string;
  species: PostSpecies[];
  blurbs: Map<string, string>;
}): string {
  const sections = parts.species.map((s) => {
    const blurb = parts.blurbs.get(s.code) ?? templateBlurb(s);
    const source = s.info?.found && s.info.pageUrl ? `[Read more on Wikipedia](${s.info.pageUrl})` : "";
    return [`## ${s.commonName}`, `*${s.scientificName}*`, imageBlock(s), blurb, source].filter(Boolean).join("\n\n");
  });
  return [
    parts.intro,
    ...sections,
    "## Final thoughts",
    parts.outro,
    "---",
    "*These species are predictions based on the time of year and the route, not confirmed sightings. " +
      "Summaries and photos come from Wikipedia and Wikimedia Commons.*",
  ].join("\n\n");
}

export function slugify(text: string, max = 80): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/, "") || "post"
  );
}

export type BuiltPost = { title: string; markdown: string; usedFallback: boolean; removedSentences: number };

/** Turns species + time of year into a post, using the LLM when it behaves and templates otherwise. */
export async function buildPost(
  species: PostSpecies[],
  when: TimeOfYear,
  llm: LlmClient,
  log: (message: string) => void = () => {},
): Promise<BuiltPost> {
  let draft: Draft | null = null;
  try {
    const raw = await llm.complete(buildMessages(species, when), { temperature: 0.7, maxTokens: 400 + species.length * 150 });
    draft = parseDraft(raw, species);
  } catch (error) {
    log(`generate: LLM output not used, falling back to the template: ${(error as Error).message}`);
  }

  const usedFallback = !draft || (!draft.intro && draft.blurbs.size === 0);
  const title = draft?.title ?? templateTitle(when);
  const markdown = assembleMarkdown({
    intro: draft?.intro || templateIntro(when),
    outro: draft?.outro || templateOutro(),
    species,
    blurbs: draft?.blurbs ?? new Map(),
  });
  return { title, markdown, usedFallback, removedSentences: draft?.removedSentences ?? 0 };
}

// ------------------------------------------------------------------ job

export function parseGenerateJob(job: Pick<Job, "payload" | "type">): GenerateInput {
  const { speciesCodes, force } = job.payload;
  if (speciesCodes !== undefined && !(Array.isArray(speciesCodes) && speciesCodes.every((c) => typeof c === "string"))) {
    throw new Error("generate job: speciesCodes must be a list of strings");
  }
  return {
    tripId: tripIdFromJob(job),
    speciesCodes: speciesCodes as string[] | undefined,
    force: force === true,
  };
}

/** `generate` job: writes (or, with `force`, rewrites) the draft post for a trip. */
export async function generatePost(db: Db, input: GenerateInput, deps: GenerateDeps): Promise<GenerateResult> {
  const now = deps.now ?? new Date();
  const log = deps.log ?? (() => {});
  const { tripId } = input;

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) throw new Error(`Trip ${tripId} not found`);

  const [existing] = await db.select().from(posts).where(eq(posts.tripId, tripId));
  if (existing && !input.force) {
    return { postId: existing.id, skipped: true, usedFallback: false, removedSentences: 0 };
  }

  const predicted = await db
    .select()
    .from(predictions)
    .where(eq(predictions.tripId, tripId))
    .orderBy(desc(predictions.probability), predictions.speciesCode);
  if (predicted.length === 0) throw new Error(`Trip ${tripId} has no predictions yet`);

  let selectedCodes: Set<string>;
  if (input.speciesCodes) selectedCodes = new Set(input.speciesCodes);
  else if (existing) {
    const rows = await db.select().from(postSpecies).where(eq(postSpecies.postId, existing.id));
    selectedCodes = new Set(rows.filter((r) => r.selected).map((r) => r.speciesCode));
  } else selectedCodes = new Set(predicted.map((p) => p.speciesCode));

  const chosen = predicted.filter((p) => selectedCodes.has(p.speciesCode));
  if (chosen.length === 0) throw new Error("Select at least one species to generate a post");

  const infoRows = await db
    .select()
    .from(speciesInfo)
    .where(inArray(speciesInfo.speciesCode, chosen.map((p) => p.speciesCode)));
  const infoByCode = new Map(infoRows.map((r) => [r.speciesCode, r]));
  const species: PostSpecies[] = chosen.map((p) => ({
    code: p.speciesCode,
    commonName: p.commonName,
    scientificName: p.scientificName,
    probability: p.probability,
    info: infoByCode.get(p.speciesCode) ?? null,
  }));

  const when = timeOfYear(midTime(trip.startedAt, trip.endedAt), trip.centroidLat < 0);
  const built = await buildPost(species, when, deps.llm, log);

  const postId = await db.transaction(async (tx) => {
    let id: number;
    if (existing) {
      id = existing.id;
      await tx
        .update(posts)
        .set({ title: built.title, markdown: built.markdown, generatedAt: now, editedAt: null })
        .where(eq(posts.id, id));
    } else {
      const [result] = await tx.insert(posts).values({
        slug: `${slugify(built.title, 80)}-${tripId}`,
        tripId,
        title: built.title,
        markdown: built.markdown,
        status: "draft",
        generatedAt: now,
      });
      id = result.insertId;
    }

    await tx.delete(postSpecies).where(
      and(
        eq(postSpecies.postId, id),
        notInArray(postSpecies.speciesCode, predicted.map((p) => p.speciesCode)),
      ),
    );
    for (const p of predicted) {
      await tx
        .insert(postSpecies)
        .values({ postId: id, speciesCode: p.speciesCode, selected: selectedCodes.has(p.speciesCode) })
        .onDuplicateKeyUpdate({ set: { selected: selectedCodes.has(p.speciesCode) } });
    }
    await tx.update(trips).set({ status: "generated" }).where(eq(trips.id, tripId));
    return id;
  });

  log(
    `generate: post ${postId} for trip ${tripId} (${species.length} species` +
      `${built.usedFallback ? ", template fallback" : ""}${built.removedSentences ? `, ${built.removedSentences} sentence(s) removed` : ""})`,
  );
  return { postId, skipped: false, usedFallback: built.usedFallback, removedSentences: built.removedSentences };
}
