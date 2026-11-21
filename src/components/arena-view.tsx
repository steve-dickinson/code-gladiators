"use client";

import type { BattleState } from "@/lib/battle-state";
import { GladiatorCard } from "./gladiator-card";
import { RematchNote, RematchResult, ScoreChange } from "./rematch-panels";

/** A battle on screen: the challenge, one card per gladiator, and the verdict. Used live and in replays. */
export function ArenaView({ state, mode }: { state: BattleState; mode: "live" | "replay" }) {
  if (!state.challenge) return null;
  const scoreOf = (id: string) => state.verdict?.scores.find((s) => s.gladiator === id);
  const allFinished = state.gladiators.length > 0 && state.gladiators.every((g) => g.status === "live" || g.status === "failed");

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400">{state.rematch ? "Rematch" : "Today’s challenge"}</p>
        <p className="mt-1 text-lg text-stone-100">{state.challenge}</p>
        {state.rematch && <RematchNote state={state} />}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {state.gladiators.map((g) => (
          <GladiatorCard
            key={g.id}
            gladiator={g}
            mode={mode}
            score={scoreOf(g.id)?.total}
            winner={state.verdict?.winner === g.id}
            coached={state.rematch?.previous[g.id] ? state.rematch.coached.includes(g.id) : undefined}
          />
        ))}
      </div>

      {!state.verdict && allFinished && <Deliberating />}
      {state.verdict && <Verdict state={state} />}
    </section>
  );
}

function Deliberating() {
  return (
    <div className="rounded-xl border border-stone-700 bg-stone-900/60 p-5">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400">
        The judge is deliberating<span className="animate-pulse">…</span>
      </p>
      <p className="mt-1 text-stone-400">Reading every line of every entry, and what the browser saw. This can take a minute or two.</p>
    </div>
  );
}

function Verdict({ state }: { state: BattleState }) {
  const verdict = state.verdict!;
  return (
    <div className="rounded-xl border border-stone-700 bg-stone-900/60 p-5">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400">The judge has spoken</p>
      <h2 className="mt-1 text-2xl font-semibold text-stone-50">{verdict.headline}</h2>
      {state.rematch && <RematchResult state={state} />}
      {verdict.sawScreenshots && (
        <p className="mt-1 font-mono text-xs text-stone-500">Judged on the code and a screenshot of each entry after it was tested.</p>
      )}
      <ol className="mt-4 space-y-3">
        {verdict.scores.map((score, i) => {
          const g = state.gladiators.find((x) => x.id === score.gladiator);
          const finalTest = g?.tests.findLast((t) => t.round === g.round) ?? g?.tests.at(-1);
          const previous = state.rematch?.previous[score.gladiator];
          return (
            <li key={score.gladiator} className="flex gap-4">
              <span className="w-6 font-mono text-stone-500">{i + 1}.</span>
              {verdict.sawScreenshots && <JudgedScreenshot src={finalTest?.screenshot} name={g?.name ?? score.gladiator} />}
              <div className="flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-semibold" style={{ color: g?.colour }}>
                    {g?.name ?? score.gladiator}
                  </span>
                  <span className="font-mono text-sm text-stone-400">
                    {score.total}/30 · creativity {score.creativity} · polish {score.polish} · fidelity {score.fidelity}
                  </span>
                  {previous && (
                    <ScoreChange before={previous.total} now={score.total} coached={state.rematch!.coached.includes(score.gladiator)} />
                  )}
                </div>
                <p className="text-stone-300 italic">“{score.roast}”</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The screenshot the judge saw of an entry. */
function JudgedScreenshot({ src, name }: { src?: string; name: string }) {
  if (!src) {
    return (
      <div className="hidden h-[72px] w-[115px] shrink-0 place-items-center rounded border border-dashed border-stone-700 font-mono text-[10px] text-stone-600 sm:grid">
        no picture
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a data URL: nothing for next/image to optimise
    <img
      src={src}
      alt={`What the judge saw of ${name}'s entry`}
      title="What the judge saw"
      className="hidden h-[72px] w-[115px] shrink-0 rounded border border-stone-700 object-cover sm:block"
    />
  );
}
