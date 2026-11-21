"use client";

import { useRef, useState } from "react";
import { BENCHMARK_RUNS } from "@/lib/benchmark";
import { errorMessage, sleep } from "@/lib/utils";

/** Time between battles, so per-minute rate limits can recover. */
const PAUSE_BETWEEN_BATTLES_MS = 60_000;

type ChallengeRuns = { id: string; title: string; challenge: string; runs: number };

/** How a single battle ended: it ran to the end, never started, or its stream was lost. */
export type BattleOutcome = "finished" | "not-started" | "stream-lost";

type Progress = {
  /** Which run of each challenge this round is, from 1 to BENCHMARK_RUNS. */
  round: number;
  total: number;
  done: number;
  current?: string;
  nextBattleAt?: number;
  stopping?: boolean;
  /** A closing message once the round ends or stops. */
  summary?: string;
};

type Props = {
  arenaKey: string;
  busy: boolean;
  runBattle: (challenge: string) => Promise<BattleOutcome>;
  onRunningChange: (running: boolean) => void;
  onError: (message: string) => void;
};

/**
 * Runs one round of the benchmark: every challenge that has fewer runs than the round
 * needs, one after another. Progress is read from the saved replays, so a stopped
 * round picks up where it left off next time.
 */
export function BenchmarkRunner({ arenaKey, busy, runBattle, onRunningChange, onError }: Props) {
  const [progress, setProgress] = useState<Progress>();
  const stopRequested = useRef(false);
  const running = progress !== undefined && !progress.summary;

  const update = (patch: Partial<Progress>) => setProgress((p) => p && { ...p, ...patch });

  async function runRound() {
    stopRequested.current = false;
    let runs: ChallengeRuns[];
    try {
      runs = await fetchRuns();
    } catch (err) {
      onError(errorMessage(err));
      return;
    }
    const round = Math.min(...runs.map((r) => r.runs)) + 1;
    if (round > BENCHMARK_RUNS) {
      setProgress({ round: BENCHMARK_RUNS, total: 0, done: 0, summary: "The benchmark is complete: every challenge has its runs." });
      return;
    }
    const queue = runs.filter((r) => r.runs < round);
    setProgress({ round, total: queue.length, done: 0 });
    onRunningChange(true);

    let done = 0;
    let problem: string | undefined;
    for (const [i, item] of queue.entries()) {
      if (stopRequested.current) break;
      update({ current: item.title, nextBattleAt: undefined });
      const outcome = await runBattle(item.challenge);
      if (outcome === "not-started") {
        problem = "the arena wouldn't start a battle";
        break;
      }
      update({ done: ++done });
      if (outcome === "stream-lost") {
        problem = "a battle stopped streaming (it may still be running: check the replays before carrying on)";
        break;
      }
      if (i < queue.length - 1) await pauseBeforeNextBattle();
    }

    const summary = problem
      ? `Stopped after ${done} of ${queue.length}: ${problem}.`
      : stopRequested.current
        ? `Stopped after ${done} of ${queue.length}, as asked.`
        : `Round ${round} done: ${done} battles.`;
    update({ current: undefined, nextBattleAt: undefined, stopping: false, summary });
    onRunningChange(false);
  }

  async function pauseBeforeNextBattle() {
    update({ current: undefined, nextBattleAt: Date.now() + PAUSE_BETWEEN_BATTLES_MS });
    for (let waited = 0; waited < PAUSE_BETWEEN_BATTLES_MS && !stopRequested.current; waited += 1000) await sleep(1000);
  }

  function requestStop() {
    stopRequested.current = true;
    update({ stopping: true });
  }

  return (
    <section className="rounded-xl border border-stone-800 bg-stone-900/40 px-4 py-3 text-sm">
      {running ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs uppercase tracking-wider text-amber-400">
            Benchmark round {progress.round} · battle {Math.min(progress.done + 1, progress.total)} of {progress.total}
          </span>
          <span className="text-stone-300">{statusText(progress)}</span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={progress.stopping}
            onClick={requestStop}
            className="rounded-lg border border-stone-600 px-3 py-1.5 text-stone-300 hover:border-red-400 hover:text-red-300 disabled:opacity-50"
          >
            {progress.stopping ? "Stopping after this battle…" : "Stop after this battle"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !arenaKey}
            onClick={runRound}
            className="rounded-lg border border-amber-500/70 px-4 py-1.5 font-medium text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
          >
            Run the next benchmark round
          </button>
          <span className="text-stone-400">
            {progress?.summary ??
              `Runs every benchmark challenge once (or the ones a round still needs), one after another with a minute between battles. Keep this tab open.${arenaKey ? "" : " Enter the arena key first."}`}
          </span>
        </div>
      )}
    </section>
  );
}

function statusText({ current, nextBattleAt }: Progress): string {
  if (current) return current;
  if (nextBattleAt) return `Pausing for rate limits; next battle at ${new Date(nextBattleAt).toLocaleTimeString("en-GB")}`;
  return "Starting…";
}

async function fetchRuns(): Promise<ChallengeRuns[]> {
  const res = await fetch("/api/benchmark", { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't read the benchmark's progress (${res.status})`);
  return ((await res.json()) as { runs: ChallengeRuns[] }).runs;
}
