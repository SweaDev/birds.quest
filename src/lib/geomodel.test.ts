import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { GeoModel, defaultModelPaths, isBirdCode, parseLabels, validateInput } from "./geomodel";

describe("parseLabels", () => {
  it("parses code, scientific and common names in order", () => {
    const labels = parseLabels("eurbla\tTurdus merula\tCommon Blackbird\n1005190\tQuesada sodalis\tQuesada sodalis\n\n");
    expect(labels).toEqual([
      { code: "eurbla", scientificName: "Turdus merula", commonName: "Common Blackbird" },
      { code: "1005190", scientificName: "Quesada sodalis", commonName: "Quesada sodalis" },
    ]);
  });

  it("falls back to the scientific name when there is no common name", () => {
    expect(parseLabels("abc1\tGenus species")[0].commonName).toBe("Genus species");
  });

  it("handles CRLF and rejects malformed lines", () => {
    expect(parseLabels("a\tb\tc\r\nd\te\tf\r\n")).toHaveLength(2);
    expect(() => parseLabels("only-one-column")).toThrow(/line 1/);
  });
});

describe("isBirdCode", () => {
  it("treats eBird codes as birds and numeric ids as other taxa", () => {
    expect(isBirdCode("gretit1")).toBe(true);
    expect(isBirdCode("comcha")).toBe(true);
    expect(isBirdCode("1020304")).toBe(false);
  });
});

describe("validateInput", () => {
  it("accepts valid input, including week 0 (whole year)", () => {
    expect(() => validateInput({ lat: 52.5, lon: 13.4, week: 22 })).not.toThrow();
    expect(() => validateInput({ lat: -90, lon: 180, week: 0 })).not.toThrow();
  });

  it.each([
    { lat: 91, lon: 0, week: 1 },
    { lat: 0, lon: -181, week: 1 },
    { lat: NaN, lon: 0, week: 1 },
    { lat: 0, lon: 0, week: 49 },
    { lat: 0, lon: 0, week: 1.5 },
  ])("rejects %o", (input) => {
    expect(() => validateInput(input)).toThrow(RangeError);
  });
});

const paths = defaultModelPaths();
const hasModel = existsSync(paths.modelPath) && existsSync(paths.labelsPath);

describe.skipIf(!hasModel)("GeoModel (needs `pnpm models:download`)", () => {
  let model: GeoModel;
  beforeAll(async () => {
    model = await GeoModel.load(paths);
  });

  it("returns one probability row per input with one value per label", async () => {
    const rows = await model.predict([
      { lat: 52.5, lon: 13.4, week: 22 },
      { lat: -33.9, lon: 151.2, week: 5 },
    ]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toHaveLength(model.species.length);
      expect(Math.min(...row)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...row)).toBeLessThanOrEqual(1);
    }
  });

  it("gives the same result regardless of batching", async () => {
    const inputs = Array.from({ length: 5 }, (_, i) => ({ lat: 50 + i, lon: 10 + i, week: 20 }));
    const whole = await model.predict(inputs, 256);
    const split = await model.predict(inputs, 2);
    expect(split.length).toBe(whole.length);
    split.forEach((row, i) => expect(Array.from(row.slice(0, 50))).toEqual(Array.from(whole[i].slice(0, 50))));
  });

  it("predicts different species for different places", async () => {
    const berlin = await model.predictAt({ lat: 52.5, lon: 13.4, week: 22 }, { topK: 10 });
    const sydney = await model.predictAt({ lat: -33.9, lon: 151.2, week: 22 }, { topK: 10 });
    expect(berlin.map((s) => s.code)).not.toEqual(sydney.map((s) => s.code));
  });

  it("filters to birds by default", async () => {
    const birds = await model.predictAt({ lat: 52.5, lon: 13.4, week: 22 }, { threshold: 0.05 });
    expect(birds.length).toBeGreaterThan(20);
    expect(birds.every((s) => isBirdCode(s.code))).toBe(true);
    const all = await model.predictAt({ lat: 52.5, lon: 13.4, week: 22 }, { threshold: 0.05, birdsOnly: false });
    expect(all.length).toBeGreaterThan(birds.length);
  });
});
