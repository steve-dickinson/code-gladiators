import { describe, expect, it } from "vitest";
import { BENCHMARK, benchmarkOf } from "./benchmark";
import { looksLikeGame } from "./browser-test";
import { LIMITS } from "./gladiators";

describe("the benchmark challenges", () => {
  it("have unique ids and fit the arena's challenge limit", () => {
    expect(new Set(BENCHMARK.map((b) => b.id)).size).toBe(BENCHMARK.length);
    for (const b of BENCHMARK) expect(b.challenge.length).toBeLessThanOrEqual(LIMITS.maxChallengeLength);
  });

  it("are only tested as games when they're games", () => {
    for (const b of BENCHMARK.filter((b) => b.category === "Games")) expect(looksLikeGame(b.challenge), b.id).toBe(true);
    for (const b of BENCHMARK.filter((b) => b.category === "Tools" || b.category === "Toys")) {
      expect(looksLikeGame(b.challenge), b.id).toBe(false);
    }
  });
});

describe("benchmarkOf", () => {
  it("matches the exact wording, ignoring spacing and case", () => {
    const snake = BENCHMARK.find((b) => b.id === "snake")!;
    expect(benchmarkOf(snake.challenge)).toBe(snake);
    expect(benchmarkOf(`  ${snake.challenge.toUpperCase().replace(/ /g, "  ")}`)).toBe(snake);
    expect(benchmarkOf("Snake game")).toBeUndefined();
    expect(benchmarkOf(undefined)).toBeUndefined();
  });
});
