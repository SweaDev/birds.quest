import { readFile } from "node:fs/promises";
import path from "node:path";
import * as ort from "onnxruntime-node";

export type Species = {
  /** eBird species code for birds (e.g. `gretit1`), numeric iNaturalist id for other taxa. */
  code: string;
  scientificName: string;
  commonName: string;
};

export type GeoInput = { lat: number; lon: number; week: number };

export const WEEKS_PER_YEAR = 48;
const DEFAULT_BATCH_SIZE = 256;

/** The model also covers insects, mammals and more; only birds have non-numeric (eBird) codes. */
export function isBirdCode(code: string): boolean {
  return !/^\d+$/.test(code);
}

/** Parses `labels.txt`: `code<TAB>scientific name<TAB>common name`, one species per line, in output order. */
export function parseLabels(text: string): Species[] {
  const species: Species[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    const [code, scientificName, commonName] = line.split("\t");
    if (!code || !scientificName) {
      throw new Error(`labels.txt line ${index + 1}: expected "code<TAB>scientific<TAB>common"`);
    }
    species.push({ code: code.trim(), scientificName: scientificName.trim(), commonName: (commonName ?? scientificName).trim() });
  }
  return species;
}

export function validateInput({ lat, lon, week }: GeoInput): void {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new RangeError(`lat out of range: ${lat}`);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new RangeError(`lon out of range: ${lon}`);
  // Week 0 means "whole year" in the model.
  if (!Number.isInteger(week) || week < 0 || week > WEEKS_PER_YEAR) throw new RangeError(`week out of range: ${week}`);
}

export type GeoModelPaths = { modelPath: string; labelsPath: string };

export function defaultModelPaths(dir = path.resolve("models")): GeoModelPaths {
  return { modelPath: path.join(dir, "geomodel_fp16.onnx"), labelsPath: path.join(dir, "labels.txt") };
}

export class GeoModel {
  private constructor(
    private readonly session: ort.InferenceSession,
    readonly species: readonly Species[],
  ) {}

  static async load(paths: GeoModelPaths = defaultModelPaths()): Promise<GeoModel> {
    const [species, session] = await Promise.all([
      readFile(paths.labelsPath, "utf8").then(parseLabels),
      ort.InferenceSession.create(paths.modelPath),
    ]);
    return new GeoModel(session, species);
  }

  /**
   * Runs the model for N points. Returns one probability row per input, in the
   * order of `species`. Inputs are processed in batches to bound memory.
   */
  async predict(inputs: GeoInput[], batchSize = DEFAULT_BATCH_SIZE): Promise<Float32Array[]> {
    inputs.forEach(validateInput);
    const rows: Float32Array[] = [];
    for (let start = 0; start < inputs.length; start += batchSize) {
      const chunk = inputs.slice(start, start + batchSize);
      const flat = new Float32Array(chunk.length * 3);
      chunk.forEach((input, i) => flat.set([input.lat, input.lon, input.week], i * 3));

      const outputs = await this.session.run({ input: new ort.Tensor("float32", flat, [chunk.length, 3]) });
      const probabilities = outputs[this.session.outputNames[0]];
      const width = this.species.length;
      if (probabilities.dims.length !== 2 || probabilities.dims[1] !== width) {
        throw new Error(`Model output ${probabilities.dims.join("x")} does not match ${width} labels`);
      }
      const data = probabilities.data as Float32Array;
      for (let i = 0; i < chunk.length; i++) rows.push(data.slice(i * width, (i + 1) * width));
    }
    return rows;
  }

  /** Species for one location and week, most likely first. */
  async predictAt(
    input: GeoInput,
    { threshold = 0, topK = Infinity, birdsOnly = true } = {},
  ): Promise<(Species & { probability: number })[]> {
    const [row] = await this.predict([input]);
    const result: (Species & { probability: number })[] = [];
    this.species.forEach((species, i) => {
      if (row[i] >= threshold && (!birdsOnly || isBirdCode(species.code))) {
        result.push({ ...species, probability: row[i] });
      }
    });
    return result.sort((a, b) => b.probability - a.probability).slice(0, topK);
  }
}

let cached: Promise<GeoModel> | undefined;

/** Loads the model once per process. */
export function getGeoModel(): Promise<GeoModel> {
  cached ??= GeoModel.load().catch((error) => {
    cached = undefined;
    throw new Error(`Could not load the GeoModel (run "pnpm models:download"): ${(error as Error).message}`);
  });
  return cached;
}
