import { describe, expect, it } from "vitest";
import { makeReplay } from "@/test/replay-fixtures";
import { BENCHMARK, BENCHMARK_FROM, BENCHMARK_VOID } from "./benchmark";
import { computeBenchmark, computeLeaderboard, countsForBenchmark } from "./leaderboard";

const snake = BENCHMARK.find((b) => b.id === "snake")!.challenge;
const afterBenchmarkStart = "2026-11-21T12:00:00.000Z";

describe("computeLeaderboard", () => {
  const replays = [
    makeReplay({
      id: "b1",
      gladiators: [
        { id: "alpha", total: 27, tests: [{ passed: false }, { passed: true }] },
        { id: "beta", total: 21, tests: [{ passed: true }] },
      ],
    }),
    makeReplay({
      id: "b2",
      gladiators: [
        { id: "alpha", total: 24, tests: [{ passed: true }] },
        { id: "beta", total: 30, tests: [{ passed: true }] },
      ],
    }),
    makeReplay({ id: "nothing-built", gladiators: [{ id: "alpha" }, { id: "beta" }] }),
  ];

  it("counts wins, averages and places per model", () => {
    const board = computeLeaderboard(replays);
    expect(board.battles).toBe(2);
    expect(board.voided).toBe(1);
    const alpha = board.models.find((m) => m.id === "alpha")!;
    expect(alpha).toMatchObject({ battles: 2, wins: 1, avgScore: 25.5, avgPlace: 1.5 });
  });

  it("counts testing: first-time passes, final passes and fixes", () => {
    const alpha = computeLeaderboard(replays).models.find((m) => m.id === "alpha")!;
    expect(alpha).toMatchObject({ tested: 2, firstTime: 1, workingAtEnd: 2, fixes: 1 });
  });

  it("leaves out coached rematch entries", () => {
    const rematch = makeReplay({
      id: "r1",
      gladiators: [
        { id: "alpha", total: 30 },
        { id: "beta", total: 10 },
      ],
      rematch: { of: "b1", coached: ["alpha"], previous: {}, feedback: {} },
    });
    const board = computeLeaderboard([rematch]);
    expect(board.coachedLeftOut).toBe(1);
    expect(board.models.map((m) => m.id)).toEqual(["beta"]);
  });
});

describe("countsForBenchmark", () => {
  const run = (overrides: Parameters<typeof makeReplay>[0]) => makeReplay({ challenge: snake, createdAt: afterBenchmarkStart, ...overrides });
  const pair = [{ id: "alpha", total: 20 }, { id: "beta", total: 25 }];

  it("counts a blind-judged run under the current rules", () => {
    expect(countsForBenchmark(run({ gladiators: pair }))).toBe(true);
  });

  it("doesn't count runs judged with names, from before the rules, voided, or rematches", () => {
    expect(countsForBenchmark(run({ gladiators: pair, blind: false }))).toBe(false);
    expect(countsForBenchmark(run({ gladiators: pair, createdAt: "2026-01-01T00:00:00.000Z" }))).toBe(false);
    expect(countsForBenchmark(run({ gladiators: pair, id: Object.keys(BENCHMARK_VOID)[0] }))).toBe(false);
    expect(countsForBenchmark(run({ gladiators: pair, rematch: { of: "x", coached: [], previous: {}, feedback: {} } }))).toBe(false);
    expect(BENCHMARK_FROM < afterBenchmarkStart).toBe(true);
  });
});

describe("computeBenchmark", () => {
  it("counts runs per challenge and splits standings by category", () => {
    const replays = [
      makeReplay({ id: "s1", challenge: snake, createdAt: afterBenchmarkStart, gladiators: [{ id: "alpha", total: 20 }, { id: "beta", total: 25 }] }),
      makeReplay({ id: "s2", challenge: `  ${snake.toUpperCase()} `, createdAt: afterBenchmarkStart, gladiators: [{ id: "alpha", total: 26 }, { id: "beta", total: 22 }] }),
      makeReplay({ id: "free", challenge: "Something else", createdAt: afterBenchmarkStart, gladiators: [{ id: "alpha", total: 30 }] }),
    ];
    const benchmark = computeBenchmark(replays);
    expect(benchmark.runs.find((r) => r.id === "snake")?.runs).toBe(2);
    expect(benchmark.overall.battles).toBe(2);
    const games = benchmark.byCategory.find((c) => c.category === "Games")!.board;
    expect(games.models.find((m) => m.id === "alpha")?.avgScore).toBe(23);
    expect(benchmark.byCategory.find((c) => c.category === "Tools")!.board.battles).toBe(0);
  });
});
