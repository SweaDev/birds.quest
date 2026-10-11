// Downloads the BirdNET+ Geomodel ONNX model, labels and licence into models/.
// Usage: pnpm models:download [--force]
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE = "v3.0.4";
const BASE_URL = `https://github.com/birdnet-team/geomodel/releases/download/${RELEASE}`;

export type ModelFile = {
  /** Asset name in the GitHub release. */
  asset: string;
  /** File name inside models/. */
  target: string;
  size: number;
  sha256: string;
};

// Checksums are the SHA-256 digests GitHub reports for the release assets.
export const MODEL_FILES: ModelFile[] = [
  {
    asset: "BirdNET+_Geomodel_V3.0.4_Global_14K_FP16.onnx",
    target: "geomodel_fp16.onnx",
    size: 7885053,
    sha256: "80e410f811bf4455e6cb1a2d48e394737d3828fe943a444646778495b67e7bab",
  },
  {
    asset: "BirdNET+_Geomodel_V3.0.4_Global_14K_Labels.txt",
    target: "labels.txt",
    size: 671823,
    sha256: "8250b457e45d43fc3e77b5cbd06a1d311baf585ab9c51ed8d42e011d98534835",
  },
  {
    asset: "LICENSE-MODELS.md",
    target: "LICENSE-MODELS.md",
    size: 11948,
    sha256: "c61a126ce3b9005b3ec0a74bd921f31214f0bec564f9067305d59e7c007796ca",
  },
];

export function assetUrl(asset: string): string {
  return `${BASE_URL}/${encodeURIComponent(asset)}`;
}

export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function sha256OfBuffer(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export class ChecksumError extends Error {}

/** Throws unless `data` has the expected size and SHA-256. */
export function verifyDownload(file: ModelFile, data: Uint8Array): void {
  if (data.byteLength !== file.size) {
    throw new ChecksumError(`${file.target}: expected ${file.size} bytes, got ${data.byteLength}`);
  }
  const actual = sha256OfBuffer(data);
  if (actual !== file.sha256) {
    throw new ChecksumError(`${file.target}: SHA-256 mismatch (expected ${file.sha256}, got ${actual})`);
  }
}

export async function downloadModels(dir: string, { force = false, log = console.log } = {}): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const file of MODEL_FILES) {
    const target = path.join(dir, file.target);
    if (!force && existsSync(target) && (await sha256OfFile(target)) === file.sha256) {
      log(`ok       ${file.target} (already present, checksum matches)`);
      continue;
    }

    log(`download ${file.asset}`);
    const response = await fetch(assetUrl(file.asset), { redirect: "follow" });
    if (!response.ok) throw new Error(`${file.asset}: HTTP ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    verifyDownload(file, data);

    // Write to a temp name first so an interrupted download never leaves a bad file.
    const tmp = `${target}.part`;
    await writeFile(tmp, data);
    await rename(tmp, target).catch(async (error) => {
      await rm(tmp, { force: true });
      throw error;
    });
    log(`saved    ${file.target} (${data.byteLength} bytes, sha256 verified)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  downloadModels(path.resolve("models"), { force: process.argv.includes("--force") }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
