import { BENCHMARK, BENCHMARK_CATEGORIES, benchmarkOf, type BenchmarkCategory } from "./benchmark";
import type { BattleData, Replay } from "./types";

// The leaderboard: every saved battle, boiled down to numbers per model. It reads the
// same replays the gallery plays, so it costs nothing to run: no model calls at all.
//
// What counts, and what doesn't:
// - A battle where no gladiator produced an entry is left out. In one battle every model
//   call failed on an expired login and the judge still handed out zeros.
// - In a rematch, the coached gladiators read feedback before writing, so their entries
//   had help the others didn't. They're left out; the control group's entries count.

export type ModelStats = {
  id: string;
  name: string;
  colour: string;
  battles: number; // battles this model fought, as counted here
  built: number; // ...in which it produced an entry
  judged: number; // ...and the judge scored it
  wins: number;
  avgScore?: number; // out of 30
  avgParts?: { creativity: number; polish: number; fidelity: number }; // each out of 10
  avgPlace?: number; // 1 is best
  tested: number; // entries the browser tested
  firstTime: number; // ...that passed the first time
  workingAtEnd: number; // ...whose final version passed
  fixes: number; // fix rounds used, in total
  aiTested: number; // final versions the AI tester used
  aiBugs: number; // ...where it found at least one bug
  medianSeconds?: number; // time from the start of the battle to a finished entry
  medianCostUsd?: number; // model fees for one entry, fixes included
  costUsd: number; // everything it spent
};

export type Leaderboard = {
  battles: number; // battles counted
  voided: number; // battles left out because nobody produced an entry
  coachedLeftOut: number; // coached rematch entries left out
  judged: number; // counted battles with a verdict
  blind: number; // ...judged blind
  sawScreenshots: number; // ...where the judge saw screenshots
  from?: string; // the first and last battle counted (ISO dates)
  to?: string;
  models: ModelStats[]; // most wins first, then the best average score
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round = (n: number | undefined, dp = 1) => (n === undefined ? undefined : Math.round(n * 10 ** dp) / 10 ** dp);

type Tally = Omit<ModelStats, "avgScore" | "avgParts" | "avgPlace" | "medianSeconds" | "medianCostUsd"> & {
  scores: number[];
  parts: { creativity: number; polish: number; fidelity: number }[];
  places: number[];
  seconds: number[];
  costs: number[];
};

// only: "tested" counts just the battles where the browser tested the entries;
// "benchmark" just the benchmark challenges (not rematches); a category, just its challenges.
export function computeLeaderboard(replays: Replay[], only: "all" | "tested" | "benchmark" | BenchmarkCategory = "all"): Leaderboard {
  const tallies = new Map<string, Tally>();
  const board: Leaderboard = { battles: 0, voided: 0, coachedLeftOut: 0, judged: 0, blind: 0, sawScreenshots: 0, models: [] };
  const dates: string[] = [];

  for (const replay of replays) {
    const battle = replay.events.find((e) => e.type === "battle")?.data as BattleData["battle"] | undefined;
    if (!battle) continue;
    const statuses = replay.events.flatMap((e) => (e.type === "status" ? [e.data] : []));
    const tests = replay.events.flatMap((e) => (e.type === "test" ? [e.data] : []));
    if (only === "tested" && tests.length === 0) continue;
    if (only !== "all" && only !== "tested") {
      const b = benchmarkOf(replay.challenge);
      if (!b || !countsForBenchmark(replay, battle) || (only !== "benchmark" && b.category !== only)) continue;
    }
    if (!statuses.some((s) => s.status === "live")) {
      board.voided++;
      continue;
    }
    const verdict = replay.events.findLast((e) => e.type === "verdict")?.data as BattleData["verdict"] | undefined;
    board.battles++;
    dates.push(replay.createdAt);
    if (verdict) {
      board.judged++;
      if (verdict.blind) board.blind++;
      if (verdict.sawScreenshots) board.sawScreenshots++;
    }
    const coached = new Set(battle.rematch?.coached ?? []);

    for (const g of battle.gladiators) {
      if (coached.has(g.id)) {
        board.coachedLeftOut++;
        continue;
      }
      let t = tallies.get(g.id);
      if (!t) {
        t = {
          id: g.id, name: g.name, colour: g.colour,
          battles: 0, built: 0, judged: 0, wins: 0, tested: 0, firstTime: 0, workingAtEnd: 0, fixes: 0, aiTested: 0, aiBugs: 0, costUsd: 0,
          scores: [], parts: [], places: [], seconds: [], costs: [],
        };
        tallies.set(g.id, t);
      }
      t.battles++;

      // The last word on this entry: "live" (it produced one) or "failed".
      const final = statuses.findLast((s) => s.gladiator === g.id && (s.status === "live" || s.status === "failed"));
      if (final?.status === "live") t.built++;
      if (final?.ms !== undefined && final.status === "live") t.seconds.push(final.ms / 1000);
      if (final?.costUsd !== undefined) {
        t.costUsd += final.costUsd;
        if (final.status === "live") t.costs.push(final.costUsd);
      }

      const mine = tests.filter((x) => x.gladiator === g.id).toSorted((a, b) => a.round - b.round);
      if (mine.length) {
        t.tested++;
        if (mine[0].round === 1 && mine[0].passed) t.firstTime++;
        const last = mine.at(-1)!;
        if (last.passed) t.workingAtEnd++;
        t.fixes += last.round - 1;
        if (last.ai) {
          t.aiTested++;
          if (last.ai.bugs.length) t.aiBugs++;
        }
      }

      const ranked = verdict?.scores ?? [];
      const place = ranked.findIndex((s) => s.gladiator === g.id);
      if (place >= 0) {
        const s = ranked[place];
        t.judged++;
        t.scores.push(s.total);
        t.parts.push({ creativity: s.creativity, polish: s.polish, fidelity: s.fidelity });
        t.places.push(place + 1);
        if (verdict?.winner === g.id) t.wins++;
      }
    }
  }

  board.models = [...tallies.values()]
    .map(({ scores, parts, places, seconds, costs, ...t }) => ({
      ...t,
      costUsd: round(t.costUsd, 4) ?? 0,
      avgScore: round(mean(scores)),
      avgParts: parts.length
        ? {
            creativity: round(mean(parts.map((p) => p.creativity)))!,
            polish: round(mean(parts.map((p) => p.polish)))!,
            fidelity: round(mean(parts.map((p) => p.fidelity)))!,
          }
        : undefined,
      avgPlace: round(mean(places)),
      medianSeconds: round(median(seconds), 0),
      medianCostUsd: round(median(costs), 4),
    }))
    .sort((a, b) => b.wins - a.wins || (b.avgScore ?? 0) - (a.avgScore ?? 0));
  dates.sort();
  board.from = dates[0];
  board.to = dates.at(-1);
  return board;
}

// A benchmark run must be played under the same rules as every other: not a rematch
// (half of those had help), and judged blind. Older battles with the same challenge were
// judged by a judge that could see model names, before the browser tests existed, so
// they stay in the "all battles" table but don't count here.
function countsForBenchmark(replay: Replay, battle: BattleData["battle"]) {
  const verdict = replay.events.findLast((e) => e.type === "verdict")?.data as BattleData["verdict"] | undefined;
  return !battle.rematch && Boolean(verdict?.blind);
}

// The benchmark at a glance: the overall table, each model's average score per kind of
// challenge, and how many times each challenge has been run so far.
export function computeBenchmark(replays: Replay[]) {
  const overall = computeLeaderboard(replays, "benchmark");
  const byCategory = BENCHMARK_CATEGORIES.map((category) => ({ category, board: computeLeaderboard(replays, category) }));
  const runs = BENCHMARK.map((b) => ({
    ...b,
    runs: replays.filter((r) => {
      const battle = r.events.find((e) => e.type === "battle")?.data as BattleData["battle"] | undefined;
      const built = r.events.some((e) => e.type === "status" && e.data.status === "live");
      return benchmarkOf(r.challenge)?.id === b.id && battle !== undefined && countsForBenchmark(r, battle) && built;
    }).length,
  }));
  return { overall, byCategory, runs };
}
