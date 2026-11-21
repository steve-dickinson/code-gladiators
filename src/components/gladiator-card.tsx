"use client";

import { useState } from "react";
import type { GladiatorView } from "@/lib/battle-state";
import { extractHtml } from "@/lib/prompt";
import type { TestReport } from "@/lib/types";
import { EntryFrame } from "./entry-frame";

const STATUS_LABEL: Record<GladiatorView["status"], string> = {
  waiting: "entering the arena",
  writing: "writing code",
  testing: "being tested",
  fixing: "fixing its bugs",
  deploying: "deploying to sandbox",
  live: "live",
  failed: "knocked out",
};

/** Characters of code shown while it streams in. */
const STREAMING_TAIL_CHARS = 3500;

type Props = {
  gladiator: GladiatorView;
  mode: "live" | "replay";
  score?: number;
  winner: boolean;
  /** In a rematch: whether this gladiator was coached. */
  coached?: boolean;
};

/** One gladiator: its code as it streams, then its entry, with test results and stats. */
export function GladiatorCard({ gladiator: g, mode, score, winner, coached }: Props) {
  const [tab, setTab] = useState<"auto" | "code" | "preview">("auto");
  const [pickedVersion, setPickedVersion] = useState<number>();
  const done = g.status === "live";
  const version = done && pickedVersion ? pickedVersion : g.round;
  const code = g.versions[version - 1] ?? "";
  const showPreview = tab === "preview" || (tab === "auto" && done);
  // The sandbox only serves the final version, and is gone by the time anyone watches a replay.
  const useSandbox = mode === "live" && g.previewUrl && version === g.round;
  const writing = g.status === "writing" || g.status === "fixing";
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
            {coached !== undefined && <CoachedBadge coached={coached} />}
          </p>
          <p className="truncate font-mono text-xs text-stone-500">{g.model}</p>
        </div>
        {score !== undefined && <span className="font-mono text-xl text-amber-300">{score}</span>}
      </header>

      <div className="relative aspect-[8/5] bg-black">
        {showPreview && code ? (
          <EntryFrame
            key={version}
            title={`${g.name} entry, version ${version}`}
            {...(useSandbox ? { src: g.previewUrl } : { srcDoc: extractHtml(code) })}
          />
        ) : g.status === "failed" && !code ? (
          <div className="grid h-full place-items-center font-mono text-sm text-stone-600">no entry</div>
        ) : (
          <div className="flex h-full flex-col-reverse overflow-hidden p-3">
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-stone-400">
              {code.slice(-STREAMING_TAIL_CHARS) || " "}
              {writing && <span className="animate-pulse text-stone-100">▋</span>}
            </pre>
          </div>
        )}
        {g.status === "testing" && (
          <div className="absolute inset-x-0 bottom-0 bg-stone-950/90 px-3 py-2 font-mono text-xs text-sky-300">
            <span className="animate-pulse">●</span> A headless browser is clicking and pressing keys, then an AI tester uses it
            for what the challenge asked…
          </div>
        )}
        {g.status === "fixing" && lastTest && !lastTest.passed && <ProblemsFound test={lastTest} />}
      </div>

      {g.tests.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stone-800 px-4 py-2 font-mono text-xs">
          {g.tests.map((t) => (
            <TestResult key={t.round} test={t} />
          ))}
          <span className="flex-1" />
          {done && g.versions.length > 1 && (
            <div className="flex gap-1">
              {g.versions.map((v, i) =>
                v ? (
                  <button
                    key={i}
                    onClick={() => setPickedVersion(i + 1)}
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
          <a href={g.previewUrl} target="_blank" rel="noreferrer" className="hover:text-stone-200">
            open ↗
          </a>
        )}
      </footer>
      {g.error && <p className="px-4 pb-3 font-mono text-xs text-red-400">{g.error}</p>}
    </article>
  );
}

function CoachedBadge({ coached }: { coached: boolean }) {
  return (
    <span
      className={`ml-2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${coached ? "bg-sky-900 text-sky-200" : "bg-stone-800 text-stone-400"}`}
    >
      {coached ? "coached" : "control"}
    </span>
  );
}

function ProblemsFound({ test }: { test: TestReport }) {
  return (
    <div className="absolute inset-x-0 top-0 max-h-28 overflow-hidden bg-red-950/90 px-3 py-2 font-mono text-[11px] leading-4 text-red-200">
      <p className="mb-1 uppercase tracking-wider text-red-400">The testers found</p>
      {[...test.errors, ...(test.ai?.bugs ?? [])].slice(0, 3).map((problem) => (
        <p key={problem} className="truncate">
          ✗ {problem}
        </p>
      ))}
      {test.blank && <p>✗ the screen stayed empty</p>}
    </div>
  );
}

function TestResult({ test: t }: { test: TestReport }) {
  return (
    <span title={testSummary(t)} className={t.passed ? "text-emerald-400" : "text-red-400"}>
      {t.passed ? "✓" : "✗"} test {t.round}
      {!t.passed && t.errors.length > 0 && ` · ${t.errors.length} error${t.errors.length > 1 ? "s" : ""}`}
      {!t.passed && t.blank && " · blank"}
      {t.ai && (t.ai.bugs.length ? ` · AI: ${t.ai.bugs.length} bug${t.ai.bugs.length > 1 ? "s" : ""}` : " · AI ✓")}
      {!t.ai && t.aiError && <span className="text-stone-500"> · AI didn&apos;t run</span>}
    </span>
  );
}

/** Hover text for a test result: everything the testers found, or what they checked. */
function testSummary(t: TestReport): string {
  const problems = [...t.errors, ...(t.blank ? ["the screen stayed empty"] : []), ...(t.ai?.bugs ?? []).map((bug) => `AI tester: ${bug}`)];
  if (t.aiError) problems.push(`The AI tester couldn't finish: ${t.aiError}`);
  if (problems.length) return problems.join("\n");
  if (t.slowBrowser) return "No errors (the test browser ran too slowly to check it properly)";
  if (!t.ai) return "No errors";
  return `No errors, and the AI tester${t.ai.kind ? ` (testing it as a ${t.ai.kind})` : ""} says: ${t.ai.summary || "it worked"}`;
}
