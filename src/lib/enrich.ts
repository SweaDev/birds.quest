import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { predictions, speciesInfo, type SpeciesInfo } from "@/db/schema";
import { enqueueJob } from "./queue";
import { WikipediaClient, WikipediaError } from "./wikipedia";

const DAY = 24 * 60 * 60_000;
// Found articles rarely change; missing ones are retried sooner in case an article appears.
export const FOUND_TTL_MS = 30 * DAY;
export const NOT_FOUND_TTL_MS = 7 * DAY;

export type SpeciesRef = { speciesCode: string; scientificName: string; commonName: string };

export function isFresh(row: Pick<SpeciesInfo, "found" | "fetchedAt">, now: Date): boolean {
  const ttl = row.found ? FOUND_TTL_MS : NOT_FOUND_TTL_MS;
  return now.getTime() - row.fetchedAt.getTime() < ttl;
}

/** Returns cached Wikipedia info for a species, fetching and caching it when missing or stale. */
export async function getSpeciesInfo(
  db: Db,
  species: SpeciesRef,
  wiki: Pick<WikipediaClient, "lookupSpecies">,
  now: Date = new Date(),
): Promise<SpeciesInfo> {
  const [cached] = await db.select().from(speciesInfo).where(eq(speciesInfo.speciesCode, species.speciesCode));
  if (cached && isFresh(cached, now)) return cached;

  const found = await wiki.lookupSpecies({
    scientificName: species.scientificName,
    commonName: species.commonName,
  });
  const values = {
    speciesCode: species.speciesCode,
    scientificName: species.scientificName,
    wikiTitle: found?.title ?? null,
    extract: found?.extract ?? null,
    pageUrl: found?.pageUrl ?? null,
    imageUrl: found?.image?.url ?? null,
    imageAttribution: found?.image?.attribution ?? null,
    imageLicense: found?.image?.license ?? null,
    imageLicenseUrl: found?.image?.licenseUrl ?? null,
    found: Boolean(found),
    fetchedAt: now,
  };
  await db
    .insert(speciesInfo)
    .values(values)
    .onDuplicateKeyUpdate({ set: values });
  const [row] = await db.select().from(speciesInfo).where(eq(speciesInfo.speciesCode, species.speciesCode));
  return row;
}

/**
 * `enrich` job: caches Wikipedia info for every predicted species, then queues
 * generation. One failing species does not stop the others; the job is retried
 * afterwards and the already cached species are skipped.
 */
export async function enrichTrip(
  db: Db,
  tripId: number,
  wiki: Pick<WikipediaClient, "lookupSpecies">,
  now: Date = new Date(),
): Promise<void> {
  const species = await db.select().from(predictions).where(eq(predictions.tripId, tripId));

  const failures: string[] = [];
  for (const prediction of species) {
    try {
      await getSpeciesInfo(db, prediction, wiki, now);
    } catch (error) {
      if (!(error instanceof WikipediaError)) throw error;
      failures.push(`${prediction.scientificName}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Wikipedia lookup failed for ${failures.length} species: ${failures.join("; ")}`);
  }

  await enqueueJob(db, { type: "generate", payload: { tripId }, dedupeKey: `generate:${tripId}`, runAfter: now });
}
