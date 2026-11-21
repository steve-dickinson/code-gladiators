"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BattleState, GladiatorView } from "@/lib/battle-state";
import { groupChange } from "@/lib/rematch";
import { extractHtml } from "@/lib/prompt";

const STATUS_LABEL: Record<GladiatorView["status"], string> = {
  waiting: "entering the arena",
  writing: "writing code",
  testing: "being tested",
  fixing: "fixing its bugs",
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
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400">
          {state.rematch ? "Rematch" : "Today\u2019s challenge"}
        </p>
        <p className="mt-1 text-lg text-stone-100">{state.challenge}</p>
        {state.rematch && <RematchNote state={state} />}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {state.gladiators.map((g) => (
          <GladiatorCard
            key={g.id}
            g={g}
            mode={mode}
            score={scoreOf(g.id)?.total}
            winner={state.verdict?.winner === g.id}
            coached={state.rematch?.previous[g.id] ? state.rematch.coached.includes(g.id) : undefined}
          />
        ))}
      </div>

      {!state.verdict && state.gladiators.length > 0 && state.gladiators.every((g) => g.status === "live" || g.status === "failed") && (
        <div className="rounded-xl border border-stone-700 bg-stone-900/60 p-5">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400">
            The judge is deliberating<span className="animate-pulse">…</span>
          </p>
          <p className="mt-1 text-stone-400">Reading every line of every entry, and what the browser saw. This can take a minute or two.</p>
        </div>
      )}

      {state.verdict && (
        <div className="rounded-xl border border-stone-700 bg-stone-900/60 p-5">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400">The judge has spoken</p>
          <h2 className="mt-1 text-2xl font-semibold text-stone-50">{state.verdict.headline}</h2>
          {state.rematch && <RematchResult state={state} />}
          {state.verdict.sawScreenshots && (
            <p className="mt-1 font-mono text-xs text-stone-500">Judged on the code and a screenshot of each entry after it was tested.</p>
          )}
          <ol className="mt-4 space-y-3">
            {state.verdict.scores.map((s, i) => {
              const g = state.gladiators.find((x) => x.id === s.gladiator);
              // The screenshot of the final version: what the judge saw.
              const shot = state.verdict?.sawScreenshots
                ? (g?.tests.findLast((t) => t.round === g.round) ?? g?.tests.at(-1))?.screenshot
                : undefined;
              return (
                <li key={s.gladiator} className="flex gap-4">
                  <span className="w-6 font-mono text-stone-500">{i + 1}.</span>
                  {state.verdict?.sawScreenshots &&
                    (shot ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing for next/image to optimise
                      <img
                        src={shot}
                        alt={`What the judge saw of ${g?.name ?? s.gladiator}'s entry`}
                        title="What the judge saw"
                        className="hidden h-[72px] w-[115px] shrink-0 rounded border border-stone-700 object-cover sm:block"
                      />
                    ) : (
                      <div className="hidden h-[72px] w-[115px] shrink-0 place-items-center rounded border border-dashed border-stone-700 font-mono text-[10px] text-stone-600 sm:grid">
                        no picture
                      </div>
                    ))}
                  <div className="flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-semibold" style={{ color: g?.colour }}>{g?.name ?? s.gladiator}</span>
                      <span className="font-mono text-sm text-stone-400">
                        {s.total}/30 · creativity {s.creativity} · polish {s.polish} · fidelity {s.fidelity}
                      </span>
                      {state.rematch?.previous[s.gladiator] && (
                        <ScoreChange
                          before={state.rematch.previous[s.gladiator].total}
                          now={s.total}
                          coached={state.rematch.coached.includes(s.gladiator)}
                        />
                      )}
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

function GladiatorCard({
  g,
  mode,
  score,
  winner,
  coached,
}: {
  g: GladiatorView;
  mode: "live" | "replay";
  score?: number;
  winner: boolean;
  coached?: boolean;
}) {
  const [tab, setTab] = useState<"auto" | "code" | "preview">("auto");
  const [picked, setPicked] = useState<number>(); // a version the viewer chose to look at
  const done = g.status === "live";
  const version = done && picked ? picked : g.round;
  const code = g.versions[version - 1] ?? "";
  const showPreview = tab === "preview" || (tab === "auto" && done);
  // In a replay the sandbox is long gone, so the preview renders from the recorded code.
  // The sandbox only serves the final version.
  const useSandbox = mode === "live" && g.previewUrl && version === g.round;
  const busy = g.status === "writing" || g.status === "fixing";
  const lastTest = g.tests.at(-1);

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
            {coached !== undefined && (
              <span className={`ml-2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${coached ? "bg-sky-900 text-sky-200" : "bg-stone-800 text-stone-400"}`}>
                {coached ? "coached" : "control"}
              </span>
            )}
          </p>
          <p className="truncate font-mono text-xs text-stone-500">{g.model}</p>
        </div>
        {score !== undefined && <span className="font-mono text-xl text-amber-300">{score}</span>}
      </header>

      <div className="relative aspect-[8/5] bg-black">
        {showPreview && code ? (
          <GameFrame
            key={version}
            title={`${g.name} entry, version ${version}`}
            {...(useSandbox ? { src: g.previewUrl } : { srcDoc: extractHtml(code) })}
          />
        ) : g.status === "failed" && !code ? (
          <div className="grid h-full place-items-center font-mono text-sm text-stone-600">no entry</div>
        ) : (
          <div className="flex h-full flex-col-reverse overflow-hidden p-3">
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-stone-400">
              {code.slice(-3500) || " "}
              {busy && <span className="animate-pulse text-stone-100">▋</span>}
            </pre>
          </div>
        )}
        {g.status === "testing" && (
          <div className="absolute inset-x-0 bottom-0 bg-stone-950/90 px-3 py-2 font-mono text-xs text-sky-300">
            <span className="animate-pulse">●</span> A headless browser is clicking and pressing keys, then an AI tester uses it for what the challenge asked…
          </div>
        )}
        {g.status === "fixing" && lastTest && !lastTest.passed && (
          <div className="absolute inset-x-0 top-0 max-h-28 overflow-hidden bg-red-950/90 px-3 py-2 font-mono text-[11px] leading-4 text-red-200">
            <p className="mb-1 uppercase tracking-wider text-red-400">The testers found</p>
            {[...lastTest.errors, ...(lastTest.ai?.bugs ?? [])].slice(0, 3).map((e) => (
              <p key={e} className="truncate">✗ {e}</p>
            ))}
            {lastTest.blank && <p>✗ the screen stayed empty</p>}
          </div>
        )}
      </div>

      {g.tests.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stone-800 px-4 py-2 font-mono text-xs">
          {g.tests.map((t) => (
            <span
              key={t.round}
              title={testSummary(t)}
              className={t.passed ? "text-emerald-400" : "text-red-400"}
            >
              {t.passed ? "✓" : "✗"} test {t.round}
              {!t.passed && t.errors.length > 0 && ` · ${t.errors.length} error${t.errors.length > 1 ? "s" : ""}`}
              {!t.passed && t.blank && " · blank"}
              {t.ai && (t.ai.bugs.length ? ` · AI: ${t.ai.bugs.length} bug${t.ai.bugs.length > 1 ? "s" : ""}` : " · AI ✓")}
              {!t.ai && t.aiError && <span className="text-stone-500"> · AI didn&apos;t run</span>}
            </span>
          ))}
          <span className="flex-1" />
          {done && g.versions.length > 1 && (
            <div className="flex gap-1">
              {g.versions.map((v, i) =>
                v ? (
                  <button
                    key={i}
                    onClick={() => setPicked(i + 1)}
                    className={`rounded px-2 py-0.5 ${version === i + 1 ? "bg-stone-800 text-stone-100" : "text-stone-400 hover:text-stone-200"}`}
                  >
                    v{i + 1}
                  </button>
                ) : null,
              )}
            </div>
          )}
        </div>
      )}

      <footer className="flex items-center gap-3 border-t border-stone-800 px-4 py-2 font-mono text-xs text-stone-400">
        <span className={g.status === "failed" ? "text-red-400" : done ? "text-emerald-400" : "text-amber-300"}>
          {STATUS_LABEL[g.status]}
          {g.round > 1 && !done && ` (round ${g.round})`}
        </span>
        {g.ms !== undefined && <span>{(g.ms / 1000).toFixed(1)}s</span>}
        {g.outputTokens !== undefined && <span>{g.outputTokens.toLocaleString()} tokens</span>}
        {g.costUsd !== undefined && <span>${g.costUsd.toFixed(4)}</span>}
        <span className="flex-1" />
        {code && (
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

// Hover text for a test result: everything the testers found, or what they checked.
function testSummary(t: GladiatorView["tests"][number]) {
  const lines = [
    ...t.errors,
    ...(t.blank ? ["the screen stayed empty"] : []),
    ...(t.ai?.bugs ?? []).map((b) => `AI tester: ${b}`),
  ];
  if (t.aiError) lines.push(`The AI tester couldn't finish: ${t.aiError}`);
  if (lines.length) return lines.join("\n");
  if (t.slowBrowser) return "No errors (the test browser ran too slowly to check it properly)";
  if (!t.ai) return "No errors";
  return `No errors, and the AI tester${t.ai.kind ? ` (testing it as a ${t.ai.kind})` : ""} says: ${t.ai.summary || "it worked"}`;
}

// Entries are written for a full browser window, so show them at a laptop-sized
// 960 x 600 (the same size the tests use) and shrink the whole page to fit the card.
// Nothing gets cut off, and you see exactly what the testers and the judge saw.
const GAME = { width: 960, height: 600 };
function GameFrame(props: { title: string; src?: string; srcDoc?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / GAME.width));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden bg-white">
      <iframe
        title={props.title}
        sandbox="allow-scripts"
        src={props.src}
        srcDoc={props.src ? undefined : props.srcDoc}
        className="border-0 bg-white"
        style={{ width: GAME.width, height: GAME.height, transform: `scale(${scale})`, transformOrigin: "0 0" }}
      />
    </div>
  );
}

// Rematches: who was coached, and exactly what they were told.
function RematchNote({ state }: { state: BattleState }) {
  const plan = state.rematch!;
  const name = (id: string) => state.gladiators.find((g) => g.id === id)?.name ?? id;
  const control = Object.keys(plan.previous).filter((id) => !plan.coached.includes(id));
  return (
    <div className="mt-2 space-y-1 text-sm text-stone-400">
      <p>
        A rematch of{" "}
        <Link href={`/replays/${plan.of}`} className="text-amber-400 hover:underline">
          an earlier battle
        </Link>
        . <span className="text-sky-300">Coached</span> (shown the judge&apos;s verdict on their last entry):{" "}
        {plan.coached.map(name).join(" and ")}. <span className="text-stone-300">Control</span> (no feedback):{" "}
        {control.map(name).join(" and ")}. The judge doesn&apos;t know which is which.
      </p>
      <details>
        <summary className="cursor-pointer font-mono text-xs text-stone-500 hover:text-stone-300">What the coached gladiators were told</summary>
        <div className="mt-2 space-y-3">
          {plan.coached.map((id) => (
            <div key={id}>
              <p className="font-mono text-xs text-sky-300">{name(id)}</p>
              <pre className="whitespace-pre-wrap font-mono text-xs text-stone-400">{plan.feedback[id]}</pre>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function ScoreChange({ before, now, coached }: { before: number; now: number; coached: boolean }) {
  const diff = Math.round((now - before) * 10) / 10;
  const colour = diff > 0 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-stone-400";
  return (
    <span className="font-mono text-xs text-stone-500">
      last time {before} → <span className={colour}>{diff > 0 ? `+${diff}` : diff}</span>
      {coached ? " \u00b7 coached" : " \u00b7 control"}
    </span>
  );
}

// The headline result of a rematch: did the coached half move more than the control half?
function RematchResult({ state }: { state: BattleState }) {
  if (!state.rematch || !state.verdict) return null;
  const { coached, control } = groupChange(state.rematch, state.verdict.scores);
  if (coached === undefined || control === undefined) return null;
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const gap = Math.round((coached - control) * 10) / 10;
  const reading =
    Math.abs(gap) < 1.5
      ? "About the same: no sign the feedback helped this time."
      : gap > 0
        ? "The coached gladiators improved more."
        : "The control group did better: the feedback didn't help this time.";
  return (
    <p className="mt-2 rounded-lg bg-stone-800/60 px-3 py-2 font-mono text-xs text-stone-300">
      Average change since last time: coached {sign(coached)}, control {sign(control)}. {reading}
    </p>
  );
}
