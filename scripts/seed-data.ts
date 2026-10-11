// Pure builders for fake GPS walks, used by the dev seed script and by tests.

export const SEED_DEVICE_ID = 9001;
const STEP_SECONDS = 10;
// Fake route centre (a park in Berlin), only used for local testing.
const CENTRE = { lat: 52.514, lon: 13.35 };

export type SeedPoint = { fixTime: Date; lat: number; lon: number; speed: number };

// Deterministic pseudo-random so reseeding gives the same walk.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// A loop of `minutes` length with a position every 10 seconds.
export function walk(start: Date, minutes: number, seed: number): SeedPoint[] {
  const rand = rng(seed);
  const steps = Math.floor((minutes * 60) / STEP_SECONDS);
  const points: SeedPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const jitter = () => (rand() - 0.5) * 0.00004;
    points.push({
      fixTime: new Date(start.getTime() + i * STEP_SECONDS * 1000),
      lat: CENTRE.lat + 0.0035 * Math.sin(angle) + jitter(),
      lon: CENTRE.lon + 0.006 * (Math.cos(angle) - 1) + jitter(),
      speed: 2.5,
    });
  }
  return points;
}

export function buildScenarios(now: Date): { name: string; points: SeedPoint[] }[] {
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  return [
    // Ended long ago and long enough: becomes a trip.
    { name: "ended 45 min walk", points: walk(minutesAgo(24 * 60 + 45), 45, 1) },
    // Ended, but shorter than the 10 minute minimum: ignored.
    { name: "ended 9 min walk", points: walk(minutesAgo(12 * 60 + 9), 9, 2) },
    // Ended, just over the minimum: accepted.
    { name: "ended 11 min walk", points: walk(minutesAgo(6 * 60 + 11), 11, 3) },
    // Still in progress (last position about a minute ago): not processed yet.
    { name: "ongoing 20 min walk", points: walk(minutesAgo(21), 20, 4) },
  ];
}
