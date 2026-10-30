"use client";

import { useEffect, useReducer, useState } from "react";
import { ArenaView } from "./arena-view";
import { battleReducer, emptyBattle } from "@/lib/battle-state";
import type { Replay } from "@/lib/types";

// Plays a recorded battle back with its original timing.
// It looks live, but costs nothing: no model calls, no sandbox.
export function ReplayPlayer({ replay }: { replay: Replay }) {
  const [state, dispatch] = useReducer(battleReducer, emptyBattle);
  const [speed, setSpeed] = useState(2);
  const [run, setRun] = useState(0);

  useEffect(() => {
    dispatch({ type: "reset" });
    const timers = replay.events.map(({ t, ...event }) => setTimeout(() => dispatch(event), t / speed));
    return () => timers.forEach(clearTimeout);
  }, [replay, speed, run]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 font-mono text-sm text-stone-400">
        <span>replay speed</span>
        {[1, 2, 4].map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`rounded px-2 py-0.5 ${speed === s ? "bg-amber-500 text-stone-950" : "hover:text-stone-100"}`}
          >
            {s}×
          </button>
        ))}
        <button onClick={() => setRun((r) => r + 1)} className="ml-2 hover:text-stone-100">
          restart ↺
        </button>
      </div>
      <ArenaView state={state} mode="replay" />
    </div>
  );
}
