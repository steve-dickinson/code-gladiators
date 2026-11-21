import type { Metadata } from "next";
import Link from "next/link";
import { BENCHMARK, BENCHMARK_CATEGORIES, BENCHMARK_FROM, BENCHMARK_RUNS } from "@/lib/benchmark";
import type { Leaderboard, ModelStats } from "@/lib/leaderboard";
import { getLeaderboard } from "@/lib/replays";

export const metadata: Metadata = {
  title: "Leaderboard · Code Gladiators",
  description: "Every saved battle, boiled down per model: wins, scores, how often the code worked first time, and what it cost.",
};

/** AI Gateway bills in US dollars; pence are shown alongside for UK readers. */
const PENCE_PER_DOLLAR = 76;

type Board = Awaited<ReturnType<typeof getLeaderboard>>;

export default async function LeaderboardPage() {
  const board = await getLeaderboard();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <Link href="/" className="font-mono text-xs uppercase tracking-[0.3em] text-amber-400">
        ← Code Gladiators
      </Link>
      <h1 className="mt-2 text-4xl font-bold text-stone-50">Leaderboard</h1>
      <p className="mt-2 max-w-2xl text-stone-400">
        Every saved battle, boiled down per model. It&apos;s worked out from the{" "}
        <Link href="/replays" className="text-amber-400 hover:underline">
          replays
        </Link>
        , so it updates after each battle and costs nothing to run.
      </p>

      <BenchmarkSection benchmark={board.benchmark} />
      <ChallengeCards runs={board.benchmark.runs} />

      {board.all.battles === 0 ? (
        <p className="mt-10 text-stone-500">No battles yet. Start one from the arena.</p>
      ) : (
        <>
          {board.tested.battles > 0 && <TestedSection board={board.tested} />}
          <AllBattlesSection board={board.all} />
          <HowToRead board={board.all} />
        </>
      )}
    </main>
  );
}

function BenchmarkSection({ benchmark }: { benchmark: Board["benchmark"] }) {
  const target = BENCHMARK.length * BENCHMARK_RUNS;
  const done = benchmark.runs.reduce((n, r) => n + Math.min(r.runs, BENCHMARK_RUNS), 0);
  const categoryScore = (modelId: string, category: string) =>
    benchmark.byCategory.find((c) => c.category === category)?.board.models.find((m) => m.id === modelId)?.avgScore;

  return (
    <Section
      title="The benchmark"
      subtitle={
        `${BENCHMARK.length} fixed challenges, each run ${BENCHMARK_RUNS} times, so every model faces the same tasks. ` +
        `${done} of ${target} runs done. Only blind-judged battles with these exact challenges, run since ` +
        `${dateTime(BENCHMARK_FROM)}, count, so every run is played under the same rules.`
      }
    >
      {benchmark.overall.battles > 0 ? (
        <Table
          head={["Model", "Wins", "Avg score", ...BENCHMARK_CATEGORIES, "Worked first time", "AI tester found bugs", "Typical cost"]}
          rows={benchmark.overall.models.map((m) => [
            <ModelName key="name" model={m} />,
            outOf(m.wins, m.judged),
            score(m.avgScore),
            ...BENCHMARK_CATEGORIES.map((c) => num(categoryScore(m.id, c))),
            outOf(m.firstTime, m.tested),
            aiFindings(m),
            money(m.medianCostUsd),
          ])}
        />
      ) : (
        <p className="px-4 py-5 text-sm text-stone-400">
          No benchmark battles yet. Press Run on any challenge below: it opens the arena with that challenge filled in, ready for
          your arena key.
        </p>
      )}
    </Section>
  );
}

function ChallengeCards({ runs }: { runs: Board["benchmark"]["runs"] }) {
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {runs.map((b) => (
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
              {Math.min(b.runs, BENCHMARK_RUNS)} of {BENCHMARK_RUNS} runs
              {b.runs > BENCHMARK_RUNS && ` (+${b.runs - BENCHMARK_RUNS} extra)`}
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
  );
}

function TestedSection({ board }: { board: Leaderboard }) {
  return (
    <Section
      title="Since the browser tests began"
      subtitle={`${plural(board.battles, "battle")}, ${dateSpan(board)}. Every entry was opened in a real browser and used; broken ones got up to two tries to fix themselves.`}
    >
      <Table
        head={["Model", "Wins", "Avg score", "Avg place", "Worked first time", "Working at the end", "Fix rounds", "AI tester found bugs", "Typical time", "Typical cost"]}
        rows={board.models.map((m) => [
          <ModelName key="name" model={m} />,
          outOf(m.wins, m.judged),
          score(m.avgScore),
          num(m.avgPlace),
          outOf(m.firstTime, m.tested),
          outOf(m.workingAtEnd, m.tested),
          m.fixes.toString(),
          aiFindings(m),
          m.medianSeconds === undefined ? "–" : `${m.medianSeconds}s`,
          money(m.medianCostUsd),
        ])}
      />
    </Section>
  );
}

function AllBattlesSection({ board }: { board: Leaderboard }) {
  return (
    <Section title="All battles" subtitle={`${plural(board.battles, "battle")}, ${dateSpan(board)}, including the early ones before any testing.`}>
      <Table
        head={["Model", "Battles", "Wins", "Avg score", "Creativity", "Polish", "Fidelity", "Avg place", "Typical cost", "Total spent"]}
        rows={board.models.map((m) => [
          <ModelName key="name" model={m} />,
          m.battles.toString(),
          m.wins.toString(),
          score(m.avgScore),
          num(m.avgParts?.creativity),
          num(m.avgParts?.polish),
          num(m.avgParts?.fidelity),
          num(m.avgPlace),
          money(m.medianCostUsd),
          money(m.costUsd),
        ])}
      />
    </Section>
  );
}

function HowToRead({ board }: { board: Leaderboard }) {
  return (
    <section className="mt-12 max-w-3xl rounded-xl border border-stone-800 bg-stone-900/40 p-5 text-sm text-stone-400">
      <h2 className="font-semibold text-stone-200">How to read this</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>
          One AI judge, from a lab that isn&apos;t competing, scores every entry out of 10 for creativity, polish and fidelity to the
          challenge. {board.blind} of {board.judged} verdicts were judged blind (entries shown as A to D, in a random order); before
          that, the judge could see which model wrote which entry. {board.sawScreenshots} of {board.judged} times, it also saw
          screenshots.
        </li>
        <li>
          Left out: {plural(board.voided, "battle")} where no model produced an entry, and {board.coachedLeftOut} rematch{" "}
          {board.coachedLeftOut === 1 ? "entry" : "entries"} from models that were shown feedback first (they had help the others
          didn&apos;t).
        </li>
        <li>
          These are small numbers and every battle has a different challenge, so one battle can move them a lot. Read it as a
          snapshot of one experiment, not a ranking of the models.
        </li>
        <li>
          Typical time is from the start of the battle to a finished, tested entry. Costs are the model&apos;s fees through AI
          Gateway, in US dollars, with pence at about {PENCE_PER_DOLLAR}p to the dollar.
        </li>
      </ul>
    </section>
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
          {head.map((heading) => (
            <th key={heading} className="px-3 py-2 align-bottom font-normal">
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i} className="border-t border-stone-800">
            {cells.map((cell, j) => (
              <td key={j} className={`whitespace-nowrap px-3 py-2.5 ${j === 0 ? "" : "font-mono text-stone-300"}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModelName({ model }: { model: ModelStats }) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap font-medium text-stone-100">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: model.colour }} />
      {model.name}
    </span>
  );
}

const num = (n?: number) => (n === undefined ? "–" : n.toString());
const score = (n?: number) => (n === undefined ? "–" : `${n} / 30`);
const outOf = (n: number, of: number) => (of ? `${n} of ${of}` : "–");
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const aiFindings = (m: ModelStats) => (m.aiTested ? outOf(m.aiBugs, m.aiTested) : "not yet");

function money(usd?: number): string {
  if (usd === undefined) return "–";
  const pence = usd * PENCE_PER_DOLLAR;
  return `$${usd.toFixed(4)} (${pence < 0.1 ? "<0.1" : pence.toFixed(1)}p)`;
}

const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

function dateSpan({ from, to }: Leaderboard): string {
  return from && to && shortDate(from) !== shortDate(to) ? `${shortDate(from)} to ${shortDate(to)}` : shortDate(from);
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}
