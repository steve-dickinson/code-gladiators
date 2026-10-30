"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import { useReducer, useState } from "react";
import { ArenaView } from "./arena-view";
import { battleReducer, emptyBattle } from "@/lib/battle-state";
import type { BattleMessage } from "@/lib/types";

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

  const { sendMessage, status, error } = useChat<BattleMessage>({
    transport: new DefaultChatTransport({ api: "/api/battle" }),
    // Every streamed battle event lands here and goes through the shared reducer.
    onData: (part) => {
      const type = part.type.slice("data-".length);
      dispatch({ type, data: part.data } as Parameters<typeof dispatch>[0]);
    },
  });

  const fighting = status === "submitted" || status === "streaming";

  function start(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge.trim() || fighting) return;
    dispatch({ type: "reset" });
    sendMessage({ text: challenge }, { headers: { "x-arena-key": key } });
  }

  return (
    <div className="space-y-8">
      <form onSubmit={start} className="space-y-3">
        <textarea
          value={challenge}
          onChange={(e) => setChallenge(e.target.value)}
          maxLength={280}
          rows={2}
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
        </div>
        {error && <p className="font-mono text-sm text-red-400">{error.message}</p>}
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
