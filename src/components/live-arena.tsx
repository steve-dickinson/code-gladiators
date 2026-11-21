"use client";

import Link from "next/link";
import { BENCHMARK, BENCHMARK_CATEGORIES, benchmarkOf } from "@/lib/benchmark";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ArenaView } from "./arena-view";
import { battleReducer, emptyBattle } from "@/lib/battle-state";
import type { BattleEvent } from "@/lib/types";

const IDEAS = [
  "Build Snake, but the snake is afraid of the dark",
  "A tiny piano that turns your typing into music",
  "Breakout where the bricks fight back",
  "A cat that follows your cursor and judges your life choices",
];

export function LiveArena() {
  const [state, dispatch] = useReducer(battleReducer, emptyBattle);
  const [challenge, setChallenge] = useState("");
  const [key, setKey] = useState("");
  const [fighting, setFighting] = useState(false);
  const [error, setError] = useState<string>();
  const watching = useRef<AbortController>(null);

  // Follow a battle's event stream. A battle can run longer than one request is
  // allowed to, so when the stream ends early we reconnect from the number of
  // events already seen, until the "done" event arrives.
  const watch = useCallback(async (runId: string) => {
    watching.current?.abort();
    const controller = new AbortController();
    watching.current = controller;
    dispatch({ type: "reset" });
    setFighting(true);
    setError(undefined);

    let seen = 0;
    let emptyTries = 0;
    try {
      while (!controller.signal.aborted) {
        const res = await fetch(`/api/battle/${runId}/stream?from=${seen}`, { signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`Couldn't watch the battle (${res.status})`);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        let got = 0;
        let finished = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line) as BattleEvent;
            seen++;
            got++;
            dispatch(event);
            if (event.type === "done") finished = true;
          }
        }
        if (finished) break;
        emptyTries = got ? 0 : emptyTries + 1;
        if (emptyTries >= 3) throw new Error("The battle stream went quiet. Refresh to try again.");
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (watching.current === controller) setFighting(false);
    }
  }, []);

  // Refreshing the page (or opening the link on your phone) picks the battle up again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const runId = params.get("run");
    const resume = runId ? setTimeout(() => watch(runId)) : undefined; // start watching after this render
    // A "Run" link from the leaderboard (/?challenge=calculator) fills in that benchmark challenge.
    const picked = BENCHMARK.find((b) => b.id === params.get("challenge"));
    const fill = picked && !runId ? setTimeout(() => setChallenge(picked.challenge)) : undefined;
    return () => {
      clearTimeout(resume);
      clearTimeout(fill);
      watching.current?.abort();
    };
  }, [watch]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge.trim() || fighting) return;
    setFighting(true);
    setError(undefined);
    try {
      const res = await fetch("/api/battle", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arena-key": key },
        body: JSON.stringify({ challenge }),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !body.runId) throw new Error(body.error ?? `The arena said no (${res.status})`);
      window.history.replaceState(null, "", `?run=${body.runId}`);
      watch(body.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFighting(false);
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={start} className="space-y-3">
        <textarea
          value={challenge}
          onChange={(e) => setChallenge(e.target.value)}
          maxLength={280}
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
            value={benchmarkOf(challenge)?.id ?? ""}
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
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {benchmarkOf(challenge) ? (
            <span className="font-mono text-xs text-amber-400">Counts towards the benchmark</span>
          ) : (
            challenge.trim() && <span className="font-mono text-xs text-stone-500">A free battle (not in the benchmark)</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Arena key"
            className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
          />
          <button
            disabled={fighting || !challenge.trim()}
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
