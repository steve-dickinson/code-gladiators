"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BENCHMARK, BENCHMARK_CATEGORIES, benchmarkOf } from "@/lib/benchmark";
import { LIMITS } from "@/lib/gladiators";
import { ArenaView } from "./arena-view";
import { BenchmarkRunner, type BattleOutcome } from "./benchmark-runner";
import { useBattleStream } from "./use-battle-stream";

/** Suggestions for free battles. None is a benchmark challenge, so clicking one never adds a benchmark run. */
const IDEAS = [
  "Build Snake, but the snake is afraid of the dark",
  "A tiny piano that turns your typing into music",
  "Pong, but the ball gets bored and wanders off",
  "A houseplant that wilts when you ignore it",
];

export function LiveArena() {
  const { state, fighting, error, setError, watch, launch } = useBattleStream();
  const [challenge, setChallenge] = useState("");
  const [arenaKey, setArenaKey] = useState("");
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);

  // A leaderboard "Run" link (/?challenge=calculator) fills in that benchmark challenge.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const picked = BENCHMARK.find((b) => b.id === params.get("challenge"));
    const fill = picked && !params.get("run") ? setTimeout(() => setChallenge(picked.challenge)) : undefined;
    return () => clearTimeout(fill);
  }, []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge.trim() || fighting) return;
    const runId = await launch(challenge, arenaKey);
    if (runId) watch(runId);
  }

  async function runBattle(text: string): Promise<BattleOutcome> {
    setChallenge(text);
    const runId = await launch(text, arenaKey);
    if (!runId) return "not-started";
    return (await watch(runId)) ? "finished" : "stream-lost";
  }

  const benchmarkChallenge = benchmarkOf(challenge);

  return (
    <div className="space-y-8">
      <form onSubmit={start} className="space-y-3">
        <textarea
          value={challenge}
          onChange={(e) => setChallenge(e.target.value)}
          maxLength={LIMITS.maxChallengeLength}
          rows={3}
          placeholder="Set the challenge…"
          className="w-full resize-none rounded-xl border border-stone-700 bg-stone-900 px-4 py-3 text-lg text-stone-100 placeholder:text-stone-600 focus:border-amber-500 focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          {IDEAS.map((idea) => (
            <button
              type="button"
              key={idea}
              onClick={() => setChallenge(idea)}
              className="rounded-full border border-stone-700 px-3 py-1 text-sm text-stone-400 hover:border-amber-500 hover:text-stone-100"
            >
              {idea}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            value={benchmarkChallenge?.id ?? ""}
            onChange={(e) => {
              const picked = BENCHMARK.find((b) => b.id === e.target.value);
              if (picked) setChallenge(picked.challenge);
            }}
            className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-stone-300 focus:border-amber-500 focus:outline-none"
          >
            <option value="">Benchmark challenges…</option>
            {BENCHMARK_CATEGORIES.map((category) => (
              <optgroup key={category} label={category}>
                {BENCHMARK.filter((b) => b.category === category).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {benchmarkChallenge ? (
            <span className="font-mono text-xs text-amber-400">Counts towards the benchmark</span>
          ) : (
            challenge.trim() && <span className="font-mono text-xs text-stone-500">A free battle (not in the benchmark)</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="password"
            value={arenaKey}
            onChange={(e) => setArenaKey(e.target.value)}
            placeholder="Arena key"
            className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
          />
          <button
            disabled={fighting || benchmarkRunning || !challenge.trim()}
            className="rounded-lg bg-amber-500 px-5 py-2 font-semibold text-stone-950 disabled:opacity-40"
          >
            {fighting ? "Battle in progress…" : "Release the gladiators"}
          </button>
          <Link href="/replays" className="text-sm text-stone-400 underline-offset-4 hover:text-stone-100 hover:underline">
            No key? Watch the replays
          </Link>
          <Link href="/leaderboard" className="text-sm text-stone-400 underline-offset-4 hover:text-stone-100 hover:underline">
            Leaderboard
          </Link>
        </div>
        {error && <p className="font-mono text-sm text-red-400">{error}</p>}
      </form>

      <BenchmarkRunner
        arenaKey={arenaKey}
        busy={fighting}
        runBattle={runBattle}
        onRunningChange={setBenchmarkRunning}
        onError={setError}
      />

      <ArenaView state={state} mode="live" />

      {state.replayId && (
        <p className="text-center font-mono text-sm text-stone-400">
          Battle saved.{" "}
          <Link href={`/replays/${state.replayId}`} className="text-amber-400 hover:underline">
            Share the replay →
          </Link>
        </p>
      )}
    </div>
  );
}
