import type { Config } from "./config";
import { enrichTrip } from "./enrich";
import { getGeoModel } from "./geomodel";
import { createLlmClient, type LlmClient } from "./llm";
import { generatePost, parseGenerateJob } from "./posts";
import { predictTrip, tripIdFromJob, type SpeciesModel } from "./predict";
import type { JobHandlers } from "./queue";
import type { PositionSource } from "./traccar";
import { discoverTrips } from "./trips";
import { WikipediaClient } from "./wikipedia";

export type HandlerDeps = {
  config: Pick<
    Config,
    "idleThresholdMinutes" | "minTripMinutes" | "predictionThreshold" | "predictionTopK" | "wikipediaUserAgent" | "llm"
  >;
  source: PositionSource;
  model?: () => Promise<SpeciesModel>;
  wiki?: Pick<WikipediaClient, "lookupSpecies">;
  llm?: LlmClient;
  log?: (message: string) => void;
  now?: () => Date;
};

export function buildHandlers({
  config,
  source,
  model = getGeoModel,
  wiki = new WikipediaClient({ userAgent: config.wikipediaUserAgent }),
  llm = createLlmClient(config.llm),
  log,
  now = () => new Date(),
}: HandlerDeps): JobHandlers {
  return {
    discover: async (_job, { db }) => {
      await discoverTrips(
        db,
        source,
        { idleThresholdMinutes: config.idleThresholdMinutes, minTripMinutes: config.minTripMinutes },
        now(),
      );
    },
    predict: async (job, { db }) => {
      await predictTrip(db, tripIdFromJob(job), {
        source,
        model,
        options: { threshold: config.predictionThreshold, topK: config.predictionTopK },
        now: now(),
      });
    },
    enrich: async (job, { db }) => {
      await enrichTrip(db, tripIdFromJob(job), wiki, now());
    },
    generate: async (job, { db }) => {
      await generatePost(db, parseGenerateJob(job), { llm, now: now(), log });
    },
  };
}
