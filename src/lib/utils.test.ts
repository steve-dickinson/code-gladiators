import { describe, expect, it } from "vitest";
import { errorMessage, mean, median, ordinal, roundTo, shuffle } from "./utils";

describe("utils", () => {
  it("formats ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th",
    ]);
  });

  it("averages and finds the middle", () => {
    expect(mean([])).toBeUndefined();
    expect(mean([1, 2, 6])).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });

  it("rounds to a number of decimals", () => {
    expect(roundTo(2.345, 2)).toBe(2.35);
    expect(roundTo(27.04)).toBe(27);
  });

  it("shuffles without losing or duplicating items", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(items).toSorted((a, b) => a - b)).toEqual(items);
  });

  it("reads messages from anything thrown, without colour codes", () => {
    expect(errorMessage(new Error("\u001b[31mfailed\u001b[0m"))).toBe("failed");
    expect(errorMessage("plain")).toBe("plain");
  });
});
