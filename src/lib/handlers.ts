import type { Config } from "./config";
import { discoverTrips } from "./trips";
import type { JobHandlers } from "./queue";
import type { PositionSource } from "./traccar";

export type HandlerDeps = {
  config: Pick<Config, "idleThresholdMinutes" | "minTripMinutes">;
  source: PositionSource;
  now?: () => Date;
};

// predict and generate handlers are registered here as they are implemented.
export function buildHandlers({ config, source, now = () => new Date() }: HandlerDeps): JobHandlers {
  return {
    discover: async (_job, { db }) => {
      await discoverTrips(
        db,
        source,
        { idleThresholdMinutes: config.idleThresholdMinutes, minTripMinutes: config.minTripMinutes },
        now(),
      );
    },
  };
}
