export type KmlPoint = { lat: number; lon: number; time?: Date };

export type ParsedKml = {
  points: KmlPoint[];
  /** Start and end found in the file itself (per-point times, `TimeSpan`, or a "from - to" name), if any. */
  start?: Date;
  end?: Date;
};

/** Larger files are rejected before parsing. */
export const MAX_KML_BYTES = 2 * 1024 * 1024;
export const MAX_KML_POINTS = 50_000;

const NAME_RANGE =
  /(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})\s*(?:-|–|—|to)\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/;

function validPoint(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function firstTag(xml: string, tag: string): string | undefined {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml)?.[1];
}

function allTags(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1]);
}

/** KML coordinates are `lon,lat[,alt]` tuples separated by whitespace. */
function parseCoordinates(text: string): KmlPoint[] {
  const points: KmlPoint[] = [];
  for (const tuple of text.trim().split(/\s+/)) {
    if (!tuple) continue;
    const [lon, lat] = tuple.split(",").map(Number);
    if (validPoint(lat, lon)) points.push({ lat, lon });
  }
  return points;
}

/**
 * Reads the route from a KML file: `LineString` coordinates and Google
 * `gx:Track` points (which also carry per-point times). Falls back to `Point`
 * placemarks when the file has no line. Throws a user-readable error otherwise.
 * The XML is only scanned with regular expressions, never resolved, so entities
 * and external references in the file are not expanded.
 */
export function parseKml(text: string): ParsedKml {
  if (Buffer.byteLength(text) > MAX_KML_BYTES) throw new Error("The file is too large (2 MB at most).");
  if (!/<kml[\s>]/i.test(text)) throw new Error("This does not look like a KML file.");
  const xml = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

  const points: KmlPoint[] = [];
  for (const line of allTags(xml, "LineString")) {
    const coordinates = firstTag(line, "coordinates");
    if (coordinates) points.push(...parseCoordinates(coordinates));
  }

  for (const track of allTags(xml, "gx:Track")) {
    const whens = allTags(track, "when").map(validDate);
    allTags(track, "gx:coord").forEach((coord, i) => {
      const [lon, lat] = coord.trim().split(/\s+/).map(Number);
      if (validPoint(lat, lon)) points.push({ lat, lon, time: whens[i] });
    });
  }

  if (points.length === 0) {
    for (const point of allTags(xml, "Point")) {
      const coordinates = firstTag(point, "coordinates");
      if (coordinates) points.push(...parseCoordinates(coordinates));
    }
  }

  if (points.length < 2) throw new Error("The file needs a route with at least two valid positions.");
  if (points.length > MAX_KML_POINTS) throw new Error(`Too many positions (${MAX_KML_POINTS} at most).`);

  const result: ParsedKml = { points };

  const times = points.flatMap((p) => (p.time ? [p.time.getTime()] : []));
  if (times.length >= 2) {
    result.start = new Date(Math.min(...times));
    result.end = new Date(Math.max(...times));
    return result;
  }

  const span = firstTag(xml, "TimeSpan");
  if (span) {
    result.start = validDate(firstTag(span, "begin"));
    result.end = validDate(firstTag(span, "end"));
    if (result.start && result.end) return result;
  }

  // Traccar's route export names the placemark "<from> - <to>".
  for (const name of allTags(xml, "name")) {
    const m = NAME_RANGE.exec(name);
    if (m) {
      result.start = validDate(`${m[1]}T${m[2]}:${m[3]}:00Z`);
      result.end = validDate(`${m[4]}T${m[5]}:${m[6]}:00Z`);
      if (result.start && result.end) return result;
    }
  }
  return { points };
}
