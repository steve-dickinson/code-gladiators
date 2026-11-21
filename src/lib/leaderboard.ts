import { BENCHMARK, BENCHMARK_CATEGORIES, BENCHMARK_FROM, BENCHMARK_RUNS, BENCHMARK_VOID, benchmarkOf, type BenchmarkCategory } from "./benchmark";
import { battleOf, hasEntries, statusesOf, testsOf, verdictOf } from "./replay-events";
import type { BattleData, Replay } from "./types";
import { mean, median, roundTo } from "./utils";

// Per-model statistics, worked out from saved replays (no model calls). Battles where
// no gladiator produced an entry are left out, and so are coached entries in rematches,
// which had help the others didn't.

export type ModelStats = {
  id: string;
  name: string;
  colour: string;
  battles: number;
  /** Battles in which it produced an entry. */
  built: number;
  /** Battles in which the judge scored it. */
  judged: number;
  wins: number;
  /** Out of 30. */
  avgScore?: number;
  /** Each out of 10. */
  avgParts?: { creativity: number; polish: number; fidelity: number };
  /** 1 is best. */
  avgPlace?: number;
  /** Entries the browser tested. */
  tested: number;
  /** Tested entries that passed first time. */
  firstTime: number;
  /** Tested entries whose final version passed. */
  workingAtEnd: number;
  /** Fix rounds used, in total. */
  fixes: number;
  /** Final versions the AI tester used. */
  aiTested: number;
  /** Final versions where the AI tester found a bug. */
  aiBugs: number;
  /** From the start of the battle to a finished entry. */
  medianSeconds?: number;
  /** Model fees for one entry, fixes included. */
  medianCostUsd?: number;
  costUsd: number;
};

export type Leaderboard = {
  battles: number;
  /** Battles left out because no gladiator produced an entry. */
  voided: number;
  coachedLeftOut: number;
  judged: number;
  blind: number;
  sawScreenshots: number;
  /** ISO dates of the first and last battle counted. */
  from?: string;
  to?: string;
  /** Most wins first, then the best average score. */
  models: ModelStats[];
};

/** Which battles to count: all, those with browser tests, the benchmark, or one benchmark category. */
export type LeaderboardScope = "all" | "tested" | "benchmark" | BenchmarkCategory;

type Tally = Pick<ModelStats, "id" | "name" | "colour"> & {
  counts: Omit<ModelStats, "id" | "name" | "colour" | "avgScore" | "avgParts" | "avgPlace" | "medianSeconds" | "medianCostUsd">;
  scores: BattleData["verdict"]["scores"];
  places: number[];
  seconds: number[];
  costs: number[];
};

export function computeLeaderboard(replays: Replay[], scope: LeaderboardScope = "all"): Leaderboard {
  const board: Leaderboard = { battles: 0, voided: 0, coachedLeftOut: 0, judged: 0, blind: 0, sawScreenshots: 0, models: [] };
  const tallies = new Map<string, Tally>();
  const dates: string[] = [];
  const countedRuns = scope === "all" || scope === "tested" ? undefined : countedBenchmarkRuns(replays);

  for (const replay of replays) {
    const battle = battleOf(replay);
    if (!battle || !inScope(replay, battle, scope, countedRuns)) continue;
    if (!hasEntries(replay)) {
      board.voided++;
      continue;
    }
    const verdict = verdictOf(replay);
    board.battles++;
    dates.push(replay.createdAt);
    if (verdict) {
      board.judged++;
      if (verdict.blind) board.blind++;
      if (verdict.sawScreenshots) board.sawScreenshots++;
    }

    for (const gladiator of battle.gladiators) {
      if (battle.rematch?.coached.includes(gladiator.id)) {
        board.coachedLeftOut++;
        continue;
      }
      const tally = tallies.get(gladiator.id) ?? newTally(gladiator);
      tallies.set(gladiator.id, tally);
      addEntry(tally, replay, verdict);
    }
  }

  board.models = [...tallies.values()].map(toStats).sort((a, b) => b.wins - a.wins || (b.avgScore ?? 0) - (a.avgScore ?? 0));
  dates.sort();
  board.from = dates[0];
  board.to = dates.at(-1);
  return board;
}

/**
 * The benchmark: overall standings, standings per category, and how many valid runs each
 * challenge has (which can exceed BENCHMARK_RUNS; only the first BENCHMARK_RUNS count).
 */
export function computeBenchmark(replays: Replay[]) {
  const runs = validBenchmarkRuns(replays);
  return {
    overall: computeLeaderboard(replays, "benchmark"),
    byCategory: BENCHMARK_CATEGORIES.map((category) => ({ category, board: computeLeaderboard(replays, category) })),
    runs: BENCHMARK.map((challenge) => ({ ...challenge, runs: runs.get(challenge.id)?.length ?? 0 })),
  };
}

/** Valid runs of each benchmark challenge, oldest first. */
function validBenchmarkRuns(replays: Replay[]): Map<string, Replay[]> {
  const runs = new Map<string, Replay[]>();
  const valid = replays.filter((r) => countsForBenchmark(r) && hasEntries(r)).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const replay of valid) {
    const challenge = benchmarkOf(replay.challenge);
    if (challenge) runs.set(challenge.id, [...(runs.get(challenge.id) ?? []), replay]);
  }
  return runs;
}

/** The ids of the runs that count: the first BENCHMARK_RUNS valid runs of each challenge, so extra runs can't tip the results. */
export function countedBenchmarkRuns(replays: Replay[]): Set<string> {
  return new Set([...validBenchmarkRuns(replays).values()].flatMap((runs) => runs.slice(0, BENCHMARK_RUNS).map((r) => r.id)));
}

/** A benchmark run counts if it isn't a rematch, was judged blind, and was run under the current rules. */
export function countsForBenchmark(replay: Replay): boolean {
  return (
    !battleOf(replay)?.rematch &&
    Boolean(verdictOf(replay)?.blind) &&
    replay.createdAt >= BENCHMARK_FROM &&
    !(replay.id in BENCHMARK_VOID)
  );
}

function inScope(replay: Replay, battle: BattleData["battle"], scope: LeaderboardScope, countedRuns?: Set<string>): boolean {
  if (scope === "all") return true;
  if (scope === "tested") return testsOf(replay).length > 0;
  const challenge = benchmarkOf(battle.challenge);
  if (!challenge || !countedRuns?.has(replay.id)) return false;
  return scope === "benchmark" || challenge.category === scope;
}

function newTally({ id, name, colour }: BattleData["battle"]["gladiators"][number]): Tally {
  return {
    id,
    name,
    colour,
    counts: { battles: 0, built: 0, judged: 0, wins: 0, tested: 0, firstTime: 0, workingAtEnd: 0, fixes: 0, aiTested: 0, aiBugs: 0, costUsd: 0 },
    scores: [],
    places: [],
    seconds: [],
    costs: [],
  };
}

function addEntry(tally: Tally, replay: Replay, verdict?: BattleData["verdict"]) {
  const { counts } = tally;
  counts.battles++;

  const outcome = statusesOf(replay).findLast((s) => s.gladiator === tally.id && (s.status === "live" || s.status === "failed"));
  if (outcome?.status === "live") {
    counts.built++;
    if (outcome.ms !== undefined) tally.seconds.push(outcome.ms / 1000);
    if (outcome.costUsd !== undefined) tally.costs.push(outcome.costUsd);
  }
  counts.costUsd += outcome?.costUsd ?? 0;

  const tests = testsOf(replay, tally.id).toSorted((a, b) => a.round - b.round);
  const finalTest = tests.at(-1);
  if (finalTest) {
    counts.tested++;
    if (tests[0].round === 1 && tests[0].passed) counts.firstTime++;
    if (finalTest.passed) counts.workingAtEnd++;
    counts.fixes += finalTest.round - 1;
    if (finalTest.ai) {
      counts.aiTested++;
      if (finalTest.ai.bugs.length) counts.aiBugs++;
    }
  }

  const place = verdict?.scores.findIndex((s) => s.gladiator === tally.id) ?? -1;
  if (verdict && place >= 0) {
    counts.judged++;
    tally.scores.push(verdict.scores[place]);
    tally.places.push(place + 1);
    if (verdict.winner === tally.id) counts.wins++;
  }
}

function toStats({ id, name, colour, counts, scores, places, seconds, costs }: Tally): ModelStats {
  const avg = (values: number[], decimals = 1) => {
    const value = mean(values);
    return value === undefined ? undefined : roundTo(value, decimals);
  };
  const med = (values: number[], decimals: number) => {
    const value = median(values);
    return value === undefined ? undefined : roundTo(value, decimals);
  };
  return {
    id,
    name,
    colour,
    ...counts,
    costUsd: roundTo(counts.costUsd, 4),
    avgScore: avg(scores.map((s) => s.total)),
    avgParts: scores.length
      ? {
          creativity: roundTo(mean(scores.map((s) => s.creativity))!),
          polish: roundTo(mean(scores.map((s) => s.polish))!),
          fidelity: roundTo(mean(scores.map((s) => s.fidelity))!),
        }
      : undefined,
    avgPlace: avg(places),
    medianSeconds: med(seconds, 0),
    medianCostUsd: med(costs, 4),
  };
}
