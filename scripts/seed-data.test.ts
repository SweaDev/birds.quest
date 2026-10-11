import { describe, expect, it } from "vitest";
import { buildScenarios, walk } from "./seed-data";

describe("seed data", () => {
  it("walks one position every 10 seconds for the requested duration", () => {
    const start = new Date("2026-01-01T10:00:00Z");
    const points = walk(start, 11, 1);
    expect(points[0].fixTime).toEqual(start);
    expect(points.at(-1)!.fixTime.getTime() - start.getTime()).toBe(11 * 60_000);
  });

  it("is deterministic", () => {
    const start = new Date("2026-01-01T10:00:00Z");
    expect(walk(start, 5, 7)).toEqual(walk(start, 5, 7));
  });

  it("builds ended, short and ongoing scenarios relative to now", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const [long, short, justOver, ongoing] = buildScenarios(now).map((s) => s.points);
    const minutes = (pts: typeof long) =>
      (pts.at(-1)!.fixTime.getTime() - pts[0].fixTime.getTime()) / 60_000;
    expect(minutes(long)).toBe(45);
    expect(minutes(short)).toBe(9);
    expect(minutes(justOver)).toBe(11);
    expect(now.getTime() - ongoing.at(-1)!.fixTime.getTime()).toBeLessThan(2 * 60_000);
  });
});
