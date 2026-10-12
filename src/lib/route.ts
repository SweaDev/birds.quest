// Route points are sampled roughly this far apart, and never more than MAX_POINTS in total.
export const SAMPLE_SPACING_METERS = 300;
export const MAX_SAMPLE_POINTS = 120;

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Keeps the first point, then every point at least `spacing` metres from the last kept one, plus the end point. */
export function sampleRoute<T extends { lat: number; lon: number }>(
  points: T[],
  spacing = SAMPLE_SPACING_METERS,
  maxPoints = MAX_SAMPLE_POINTS,
): T[] {
  if (points.length === 0) return [];
  const kept = [points[0]];
  for (const point of points.slice(1)) {
    if (haversineMeters(kept.at(-1)!, point) >= spacing) kept.push(point);
  }
  const last = points.at(-1)!;
  if (kept.at(-1) !== last && haversineMeters(kept.at(-1)!, last) > 0) kept.push(last);

  if (kept.length <= maxPoints) return kept;
  // Too long a route: thin out evenly, keeping both ends.
  return Array.from({ length: maxPoints }, (_, i) => kept[Math.round((i * (kept.length - 1)) / (maxPoints - 1))]);
}
