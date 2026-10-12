export function siteUrl(): string {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export const SITE_NAME = "birds.quest";
export const SITE_TAGLINE = "Birds you might spot on a walk, predicted from the season and the route.";
