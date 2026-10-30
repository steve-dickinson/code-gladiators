import Link from "next/link";
import { listReplays } from "@/lib/replays";
import { GLADIATORS } from "@/lib/gladiators";

export default async function ReplaysPage() {
  const replays = await listReplays();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <Link href="/" className="font-mono text-xs uppercase tracking-[0.3em] text-amber-400">← Code Gladiators</Link>
      <h1 className="mt-2 text-4xl font-bold text-stone-50">Battle replays</h1>
      <p className="mt-2 text-stone-400">Every fight, recorded token by token. Pick one and watch it unfold.</p>
      {replays.length === 0 && <p className="mt-10 text-stone-500">No battles yet. Start one from the arena.</p>}
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {replays.map((r) => {
          const winner = GLADIATORS.find((g) => g.id === r.winner);
          return (
            <li key={r.id}>
              <Link
                href={`/replays/${r.id}`}
                className="block h-full rounded-xl border border-stone-800 bg-stone-900/50 p-4 hover:border-amber-500"
              >
                <p className="text-stone-100">{r.challenge}</p>
                <p className="mt-3 font-mono text-xs text-stone-500">
                  {new Date(r.createdAt).toLocaleDateString("en-GB")}
                  {winner && <> · won by <span style={{ color: winner.colour }}>{winner.name}</span></>}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
