import { describe, expect, it } from "vitest";
import { MAX_KML_BYTES, parseKml } from "./kml";

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>${body}</Document></kml>`;

describe("parseKml", () => {
  it("reads LineString coordinates as lon,lat and takes the time range from a Traccar-style name", () => {
    const parsed = parseKml(
      wrap(
        `<Placemark><name>2026-10-10 18:00 - 2026-10-11 17:59</name><LineString><coordinates>90.37,23.79,17.3 90.38,23.80,16.0\n90.39,23.81</coordinates></LineString></Placemark>`,
      ),
    );
    expect(parsed.points).toEqual([
      { lat: 23.79, lon: 90.37 },
      { lat: 23.8, lon: 90.38 },
      { lat: 23.81, lon: 90.39 },
    ]);
    expect(parsed.start?.toISOString()).toBe("2026-10-10T18:00:00.000Z");
    expect(parsed.end?.toISOString()).toBe("2026-10-11T17:59:00.000Z");
  });

  it("reads gx:Track points and uses their times", () => {
    const parsed = parseKml(
      wrap(
        `<Placemark><gx:Track><when>2026-06-10T08:00:00Z</when><when>2026-06-10T08:30:00Z</when><gx:coord>13.0 52.0 0</gx:coord><gx:coord>13.1 52.1 0</gx:coord></gx:Track></Placemark>`,
      ),
    );
    expect(parsed.points.map((p) => [p.lat, p.lon])).toEqual([
      [52, 13],
      [52.1, 13.1],
    ]);
    expect(parsed.start?.toISOString()).toBe("2026-06-10T08:00:00.000Z");
    expect(parsed.end?.toISOString()).toBe("2026-06-10T08:30:00.000Z");
  });

  it("uses a TimeSpan, and reports no times when the file has none", () => {
    const span = parseKml(
      wrap(
        `<Placemark><TimeSpan><begin>2026-06-10T08:00:00Z</begin><end>2026-06-10T09:00:00Z</end></TimeSpan><LineString><coordinates>13,52 13.1,52.1</coordinates></LineString></Placemark>`,
      ),
    );
    expect(span.end?.toISOString()).toBe("2026-06-10T09:00:00.000Z");

    const none = parseKml(wrap(`<Placemark><name>Walk</name><LineString><coordinates>13,52 13.1,52.1</coordinates></LineString></Placemark>`));
    expect(none.start).toBeUndefined();
    expect(none.end).toBeUndefined();
  });

  it("falls back to Point placemarks and skips invalid positions", () => {
    const parsed = parseKml(
      wrap(
        `<Placemark><Point><coordinates>13,52</coordinates></Point></Placemark><Placemark><Point><coordinates>13.1,52.1</coordinates></Point></Placemark><Placemark><Point><coordinates>400,95</coordinates></Point></Placemark>`,
      ),
    );
    expect(parsed.points).toHaveLength(2);
  });

  it("ignores commented-out routes and does not expand entities", () => {
    const parsed = parseKml(
      `<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY x SYSTEM "file:///etc/passwd">]><kml><Document><!-- <LineString><coordinates>1,1 2,2</coordinates></LineString --><Placemark><name>&x;</name><LineString><coordinates>13,52 13.1,52.1</coordinates></LineString></Placemark></Document></kml>`,
    );
    expect(parsed.points).toHaveLength(2);
  });

  it("rejects non-KML, too-short and oversized input", () => {
    expect(() => parseKml("<html></html>")).toThrow(/KML/);
    expect(() => parseKml(wrap(`<Placemark><LineString><coordinates>13,52</coordinates></LineString></Placemark>`))).toThrow(/two valid/);
    expect(() => parseKml(wrap("x".repeat(MAX_KML_BYTES)))).toThrow(/too large/);
  });
});
