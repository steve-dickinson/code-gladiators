"use client";

import { useState } from "react";
import { finalHtml, type BattleState, type GladiatorView } from "@/lib/battle-state";

const STATUS_LABEL: Record<GladiatorView["status"], string> = {
  waiting: "entering the arena",
  writing: "writing code",
  deploying: "deploying to sandbox",
  live: "live",
  failed: "knocked out",
};

export function ArenaView({ state, mode }: { state: BattleState; mode: "live" | "replay" }) {
  if (!state.challenge) return null;
  const scoreOf = (id: string) => state.verdict?.scores.find((s) => s.gladiator === id);

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400">Today&apos;s challenge</p>
        <p className="mt-1 text-lg text-stone-100">{state.challenge}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {state.gladiators.map((g) => (
          <GladiatorCard
            key={g.id}
            g={g}
            mode={mode}
            score={scoreOf(g.id)?.total}
            winner={state.verdict?.winner === g.id}
          />
        ))}
      </div>

      {state.verdict && (
        <div className="rounded-xl border border-stone-700 bg-stone-900/60 p-5">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400">The judge has spoken</p>
          <h2 className="mt-1 text-2xl font-semibold text-stone-50">{state.verdict.headline}</h2>
          <ol className="mt-4 space-y-3">
            {state.verdict.scores.map((s, i) => {
              const g = state.gladiators.find((x) => x.id === s.gladiator);
              return (
                <li key={s.gladiator} className="flex gap-4">
                  <span className="w-6 font-mono text-stone-500">{i + 1}.</span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-semibold" style={{ color: g?.colour }}>{g?.name ?? s.gladiator}</span>
                      <span className="font-mono text-sm text-stone-400">
                        {s.total}/30 · creativity {s.creativity} · polish {s.polish} · fidelity {s.fidelity}
                      </span>
                    </div>
                    <p className="text-stone-300 italic">“{s.roast}”</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

function GladiatorCard({ g, mode, score, winner }: { g: GladiatorView; mode: "live" | "replay"; score?: number; winner: boolean }) {
  const [tab, setTab] = useState<"auto" | "code" | "preview">("auto");
  const done = g.status === "live";
  const showPreview = tab === "preview" || (tab === "auto" && done);
  // In a replay the sandbox is long gone, so the preview renders from the recorded code.
  const useSandbox = mode === "live" && g.previewUrl;

  return (
    <article
      className="flex flex-col overflow-hidden rounded-xl border bg-stone-950"
      style={{ borderColor: winner ? "#f59e0b" : `${g.colour}55`, boxShadow: winner ? "0 0 0 2px #f59e0b55" : undefined }}
    >
      <header className="flex items-center gap-3 border-b border-stone-800 px-4 py-3">
        <span className="h-3 w-3 rounded-full" style={{ background: g.colour }} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-stone-100">
            {g.name} {winner && <span className="ml-1 font-mono text-xs text-amber-400">WINNER</span>}
          </p>
          <p className="truncate font-mono text-xs text-stone-500">{g.model}</p>
        </div>
        {score !== undefined && <span className="font-mono text-xl text-amber-300">{score}</span>}
      </header>

      <div className="relative h-80 bg-black">
        {showPreview && g.code ? (
          <iframe
            title={`${g.name} entry`}
            sandbox="allow-scripts"
            className="h-full w-full bg-white"
            {...(useSandbox ? { src: g.previewUrl } : { srcDoc: finalHtml(g) })}
          />
        ) : g.status === "failed" && !g.code ? (
          <div className="grid h-full place-items-center font-mono text-sm text-stone-600">no entry</div>
        ) : (
          <div className="flex h-full flex-col-reverse overflow-hidden p-3">
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-stone-400">
              {g.code.slice(-3500) || " "}
              {g.status === "writing" && <span className="animate-pulse text-stone-100">▋</span>}
            </pre>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-stone-800 px-4 py-2 font-mono text-xs text-stone-400">
        <span className={g.status === "failed" ? "text-red-400" : done ? "text-emerald-400" : "text-amber-300"}>
          {STATUS_LABEL[g.status]}
        </span>
        {g.ms !== undefined && <span>{(g.ms / 1000).toFixed(1)}s</span>}
        {g.outputTokens !== undefined && <span>{g.outputTokens.toLocaleString()} tokens</span>}
        {g.costUsd !== undefined && <span>${g.costUsd.toFixed(4)}</span>}
        <span className="flex-1" />
        {g.code && (
          <div className="flex gap-1">
            {(["code", "preview"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-2 py-0.5 ${(showPreview ? "preview" : "code") === t ? "bg-stone-800 text-stone-100" : "hover:text-stone-200"}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {useSandbox && (
          <a href={g.previewUrl} target="_blank" rel="noreferrer" className="hover:text-stone-200">open ↗</a>
        )}
      </footer>
      {g.error && <p className="px-4 pb-3 font-mono text-xs text-red-400">{g.error}</p>}
    </article>
  );
}
