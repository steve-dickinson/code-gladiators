import type { Metadata } from "next";
import Link from "next/link";
import { BENCHMARK, BENCHMARK_CATEGORIES, BENCHMARK_RUNS } from "@/lib/benchmark";
import type { Leaderboard, ModelStats } from "@/lib/leaderboard";
import { getLeaderboard } from "@/lib/replays";

export const metadata: Metadata = {
  title: "Leaderboard · Code Gladiators",
  description: "Every saved battle, boiled down per model: wins, scores, how often the code worked first time, and what it cost.",
};

// AI Gateway bills in US dollars; this is only for showing pence alongside.
const PENCE_PER_DOLLAR = 76;

const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
const span = (b: Leaderboard) => (b.from && b.to && date(b.from) !== date(b.to) ? `${date(b.from)} to ${date(b.to)}` : date(b.from));
const money = (usd?: number) => {
  if (usd === undefined) return "–";
  const pence = usd * PENCE_PER_DOLLAR;
  return `$${usd.toFixed(4)} (${pence < 0.1 ? "<0.1" : pence.toFixed(1)}p)`;
};
const outOf = (n: number, of: number) => (of ? `${n} of ${of}` : "–");
const num = (n?: number) => (n === undefined ? "–" : n.toString());

export default async function LeaderboardPage() {
  const { all, tested, benchmark } = await getLeaderboard();
  const target = BENCHMARK.length * BENCHMARK_RUNS;
  const done = benchmark.runs.reduce((n, r) => n + Math.min(r.runs, BENCHMARK_RUNS), 0);
  const categoryScore = (id: string, category: string) =>
    benchmark.byCategory.find((c) => c.category === category)?.board.models.find((m) => m.id === id)?.avgScore;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <Link href="/" className="font-mono text-xs uppercase tracking-[0.3em] text-amber-400">← Code Gladiators</Link>
      <h1 className="mt-2 text-4xl font-bold text-stone-50">Leaderboard</h1>
      <p className="mt-2 max-w-2xl text-stone-400">
        Every saved battle, boiled down per model. It&apos;s worked out from the{" "}
        <Link href="/replays" className="text-amber-400 hover:underline">replays</Link>, so it updates after each battle and costs
        nothing to run.
      </p>

      <Section
        title="The benchmark"
        subtitle={`${BENCHMARK.length} fixed challenges, each run ${BENCHMARK_RUNS} times, so every model faces the same tasks. ${done} of ${target} runs done. Only blind-judged battles with these exact challenges count, so every run is played under the same rules.`}
      >
        {benchmark.overall.battles > 0 ? (
          <Table
            head={["Model", "Wins", "Avg score", ...BENCHMARK_CATEGORIES, "Worked first time", "AI tester found bugs", "Typical cost"]}
            rows={benchmark.overall.models.map((m) => [
              <Name key="n" m={m} />,
              outOf(m.wins, m.judged),
              m.avgScore === undefined ? "–" : `${m.avgScore} / 30`,
              ...BENCHMARK_CATEGORIES.map((c) => num(categoryScore(m.id, c))),
              outOf(m.firstTime, m.tested),
              m.aiTested ? outOf(m.aiBugs, m.aiTested) : "not yet",
              money(m.medianCostUsd),
            ])}
          />
        ) : (
          <p className="px-4 py-5 text-sm text-stone-400">
            No benchmark battles yet. Press Run on any challenge below: it opens the arena with that challenge filled in,
            ready for your arena key.
          </p>
        )}
      </Section>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {benchmark.runs.map((b) => (
          <li key={b.id} className="rounded-xl border border-stone-800 bg-stone-900/40 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium text-stone-100">{b.title}</p>
              <p className="font-mono text-[11px] uppercase tracking-wider text-stone-500">{b.category}</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-400">{b.challenge}</p>
            <p className="mt-3 flex items-center gap-1.5 font-mono text-xs text-stone-400">
              {Array.from({ length: BENCHMARK_RUNS }, (_, i) => (
                <span key={i} className={`h-2 w-2 rounded-full ${i < b.runs ? "bg-amber-400" : "bg-stone-700"}`} />
              ))}
              <span className="ml-1">
                {Math.min(b.runs, BENCHMARK_RUNS)} of {BENCHMARK_RUNS} runs{b.runs > BENCHMARK_RUNS ? ` (+${b.runs - BENCHMARK_RUNS} extra)` : ""}
              </span>
              <Link
                href={`/?challenge=${b.id}`}
                className="ml-auto rounded-md border border-amber-500/60 px-2.5 py-1 font-sans text-xs font-medium text-amber-300 hover:border-amber-400 hover:bg-amber-500/10"
              >
                Run →
              </Link>
            </p>
          </li>
        ))}
      </ul>

      {all.battles === 0 ? (
        <p className="mt-10 text-stone-500">No battles yet. Start one from the arena.</p>
      ) : (
        <>
          {tested.battles > 0 && (
            <Section
              title="Since the browser tests began"
              subtitle={`${tested.battles} battle${tested.battles > 1 ? "s" : ""}, ${span(tested)}. Every entry was opened in a real browser and used; broken ones got up to two tries to fix themselves.`}
            >
              <Table
                head={["Model", "Wins", "Avg score", "Avg place", "Worked first time", "Working at the end", "Fix rounds", "AI tester found bugs", "Typical time", "Typical cost"]}
                rows={tested.models.map((m) => [
                  <Name key="n" m={m} />,
                  outOf(m.wins, m.judged),
                  m.avgScore === undefined ? "–" : `${m.avgScore} / 30`,
                  num(m.avgPlace),
                  outOf(m.firstTime, m.tested),
                  outOf(m.workingAtEnd, m.tested),
                  m.fixes.toString(),
                  m.aiTested ? outOf(m.aiBugs, m.aiTested) : "not yet",
                  m.medianSeconds === undefined ? "–" : `${m.medianSeconds}s`,
                  money(m.medianCostUsd),
                ])}
              />
            </Section>
          )}

          <Section title="All battles" subtitle={`${all.battles} battle${all.battles > 1 ? "s" : ""}, ${span(all)}, including the early ones before any testing.`}>
            <Table
              head={["Model", "Battles", "Wins", "Avg score", "Creativity", "Polish", "Fidelity", "Avg place", "Typical cost", "Total spent"]}
              rows={all.models.map((m) => [
                <Name key="n" m={m} />,
                m.battles.toString(),
                m.wins.toString(),
                m.avgScore === undefined ? "–" : `${m.avgScore} / 30`,
                num(m.avgParts?.creativity),
                num(m.avgParts?.polish),
                num(m.avgParts?.fidelity),
                num(m.avgPlace),
                money(m.medianCostUsd),
                money(m.costUsd),
              ])}
            />
          </Section>

          <section className="mt-12 max-w-3xl rounded-xl border border-stone-800 bg-stone-900/40 p-5 text-sm text-stone-400">
            <h2 className="font-semibold text-stone-200">How to read this</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                One AI judge, from a lab that isn&apos;t competing, scores every entry out of 10 for creativity, polish and fidelity
                to the challenge. {all.blind} of {all.judged} verdicts were judged blind (entries shown as A to D, in a random
                order); before that, the judge could see which model wrote which entry. {all.sawScreenshots} of {all.judged} times,
                it also saw screenshots.
              </li>
              <li>
                Left out: {all.voided} battle{all.voided === 1 ? "" : "s"} where no model produced an entry, and{" "}
                {all.coachedLeftOut} rematch entr{all.coachedLeftOut === 1 ? "y" : "ies"} from models that were shown feedback
                first (they had help the others didn&apos;t).
              </li>
              <li>
                These are small numbers and every battle has a different challenge, so one battle can move them a lot. Read it as
                a snapshot of one experiment, not a ranking of the models.
              </li>
              <li>
                Typical time is from the start of the battle to a finished, tested entry. Costs are the model&apos;s fees through
                AI Gateway, in US dollars, with pence at about {PENCE_PER_DOLLAR}p to the dollar.
              </li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-stone-100">{title}</h2>
      <p className="mt-1 text-sm text-stone-400">{subtitle}</p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-stone-800">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table className="w-full min-w-[56rem] text-left text-sm">
      <thead className="bg-stone-900 font-mono text-[11px] uppercase tracking-wider text-stone-400">
        <tr>
          {head.map((h) => (
            <th key={h} className="px-3 py-2 align-bottom font-normal">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i} className="border-t border-stone-800">
            {cells.map((c, j) => (
              <td key={j} className={`whitespace-nowrap px-3 py-2.5 ${j === 0 ? "" : "font-mono text-stone-300"}`}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Name({ m }: { m: ModelStats }) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap font-medium text-stone-100">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.colour }} />
      {m.name}
    </span>
  );
}
