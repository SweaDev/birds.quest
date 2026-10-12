import { describe, expect, it } from "vitest";
import { findLocationLeaks, hasLocationLeak, maskNames, splitSentences, stripPlaceSentences } from "./locations";

describe("findLocationLeaks", () => {
  it.each([
    ["52.5140, 13.3500", "coordinate pair"],
    ["at 52.51403 north", "decimal coordinate"],
    ["around 52° 30' N", "degrees"],
    ["its latitude is high", "coordinates word"],
    ["recorded by GPS", "coordinates word"],
    ["see https://maps.example/x", "url"],
    ["open Google Maps", "map link"],
  ])("rejects %s", (text, label) => {
    expect(findLocationLeaks(text).hard).toContain(label);
  });

  it("finds place names", () => {
    expect(findLocationLeaks("Found across Europe and Asia, also in Berlin.").places).toEqual(
      expect.arrayContaining(["Europe", "Asia", "Berlin"]),
    );
    expect(findLocationLeaks("A walk in New York City and North America").places).toEqual(
      expect.arrayContaining(["New York City", "North America"]),
    );
  });

  it("does not flag ordinary text, bird words or Latin names", () => {
    expect(hasLocationLeak("The turkey is a large bird. Turdus niger is a Latin name. It weighs 5 kg.")).toBe(false);
    expect(hasLocationLeak("Great tits are lively birds with a black head.")).toBe(false);
    expect(hasLocationLeak("It was first described in 1758 and has 12 subspecies.")).toBe(false);
  });

  it("does not match place names inside other words", () => {
    expect(hasLocationLeak("Americana and Chadwick and Germanic")).toBe(false);
  });

  it("is case-sensitive for country names, so the bird 'turkey' passes", () => {
    expect(hasLocationLeak("a wild turkey")).toBe(false);
    expect(hasLocationLeak("Visit Turkey")).toBe(true);
  });

  it("ignores species names that contain place words", () => {
    const allowed = ["Turkey Vulture", "Atlantic Puffin", "Fratercula arctica"];
    expect(hasLocationLeak("The Turkey Vulture and the Atlantic Puffin share a sky.", allowed)).toBe(false);
    expect(hasLocationLeak("The Turkey Vulture lives in Mexico.", allowed)).toBe(true);
    expect(maskNames("Turkey Vulture", allowed)).toBe("§");
  });
});

describe("stripPlaceSentences", () => {
  it("drops whole sentences that name a place", () => {
    const { text, removed } = stripPlaceSentences("The robin is small. It is common in Germany. It sings at dawn!");
    expect(text).toBe("The robin is small. It sings at dawn!");
    expect(removed).toEqual(["It is common in Germany."]);
  });

  it("keeps everything when there is nothing to remove", () => {
    expect(stripPlaceSentences("One. Two.").removed).toEqual([]);
  });

  it("splits sentences on terminators and newlines", () => {
    expect(splitSentences("A b. C d!\nE f")).toEqual(["A b.", "C d!", "E f"]);
  });
});
