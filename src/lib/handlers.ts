import type { Config } from "./config";
import { getGeoModel } from "./geomodel";
import { predictTrip, tripIdFromJob, type SpeciesModel } from "./predict";
import type { JobHandlers } from "./queue";
import type { PositionSource } from "./traccar";
import { discoverTrips } from "./trips";

export type HandlerDeps = {
  config: Pick<
    Config,
    "idleThresholdMinutes" | "minTripMinutes" | "predictionThreshold" | "predictionTopK"
  >;
  source: PositionSource;
  model?: () => Promise<SpeciesModel>;
  now?: () => Date;
};

// enrich and generate handlers are registered here as they are implemented.
export function buildHandlers({
  config,
  source,
  model = getGeoModel,
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
      });
    },
  };
}
