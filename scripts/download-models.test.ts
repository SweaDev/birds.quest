import { describe, expect, it } from "vitest";
import { ChecksumError, MODEL_FILES, assetUrl, sha256OfBuffer, verifyDownload } from "./download-models";

describe("download-models", () => {
  it("pins every file to a release URL, size and sha256", () => {
    for (const file of MODEL_FILES) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.size).toBeGreaterThan(0);
    }
    expect(MODEL_FILES.map((f) => f.target).sort()).toEqual(["LICENSE-MODELS.md", "geomodel_fp16.onnx", "labels.txt"]);
  });

  it("url-encodes the + in asset names", () => {
    expect(assetUrl("BirdNET+_Geomodel_V3.0.4_Global_14K_Labels.txt")).toBe(
      "https://github.com/birdnet-team/geomodel/releases/download/v3.0.4/BirdNET%2B_Geomodel_V3.0.4_Global_14K_Labels.txt",
    );
  });

  it("accepts data with the expected size and checksum", () => {
    const data = new TextEncoder().encode("hello");
    const file = { asset: "a", target: "a", size: data.byteLength, sha256: sha256OfBuffer(data) };
    expect(() => verifyDownload(file, data)).not.toThrow();
  });

  it("rejects data with a wrong size or checksum", () => {
    const data = new TextEncoder().encode("hello");
    const good = { asset: "a", target: "a", size: data.byteLength, sha256: sha256OfBuffer(data) };
    expect(() => verifyDownload({ ...good, size: 3 }, data)).toThrow(ChecksumError);
    expect(() => verifyDownload({ ...good, sha256: "0".repeat(64) }, data)).toThrow(/mismatch/);
  });
});
